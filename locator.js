/**
 * @fileoverview Web server providing a REST interface to the Locator microservice.  Implmented
 * on GCP App Engine Flexible.
 * @author Joey Whelan <joey.whelan@gmail.com>
 */
/*jshint esversion: 6 */
'use strict';
'use esversion 6';

const PORT = process.env.PORT || 8080;
const REDISHOST = process.env.REDISHOST || 'localhost';
const REDISPORT = process.env.REDISPORT || 6379;
const MAPSURL = process.env.MAPSURL || 'https://www.google.com/maps/dir/?api=1';
const APIKEY = process.env.APIKEY;

const express = require('express');
const redis = require('redis');
const util = require('util');
const maps = require('@google/maps');

const app = express();
const redisClient = redis.createClient(REDISPORT, REDISHOST);
const hgetallAsync = util.promisify(redisClient.hgetall).bind(redisClient);
const keysAsync = util.promisify(redisClient.keys).bind(redisClient);
const mapsClient = maps.createClient({
	key: APIKEY,
	Promise: Promise
  });

let storeList = [];

/**
 * Helper function for sorting distances to stores
 * @param {object} a - distance from origin to store
 * @param {object} b - lat/long(s) of store locations
 * @return {int} - comparison of the distance values
 */
function compareDist(a, b) {
	if (a.distance < b.distance) return -1;
	if (a.distance > b.distance) return 1;
	return 0;
}

/**
 * Fetches the closest store location based on the user's lat/long
 * Performs an initial filtering based ZIP code only, then refines a configurable number of closest
 * stores using actual driving distance from the Google Maps Distance Matrix
 * API.
 * @param {string} origin - lat/long of origin location
 * @param {array of strings} stores - lat/long(s) of store locations
 * @return {string} - URL of Google map with nearest store
 */
function getClosestStore(origin, stores) {
	console.log(`getClosestStore(${JSON.stringify(origin)})`);
	
	let dests = [];
	for (const store of stores) {
		dests.push({lat: store.lat, lng: store.long});
	}
	return mapsClient.distanceMatrix({
		'origins': [{lat: origin.lat, lng: origin.long}],
		'destinations': dests
	})
	.asPromise()
	.then((response) => {
		if (response.status == 200 && response.json.status == 'OK') {
			let minIndex;
			let minDist;
			const elements = response.json.rows[0].elements
			for (let i=0; i < elements.length; i++) {
				if (minDist == null || elements[i].distance.value < minDist) {
					minIndex = i;
					minDist = elements[i].distance.value;
				}
			}
			return stores[minIndex];
		}
		else {
			throw new Error('invalid return status on Google distanceMatrix API call');
		}
	})
	.catch(err => {
		console.error(`getClosestStore(): ${JSON.stringify(err)}`);
		throw err;
	});
}

/**
 * Creates a google maps url with the directions from an origin to a store location.
 * @param {object} origin - latitude & longitude
 * @param {object} store - object containing store address info, to include latitude & longitude
 * @return {string} - Google Maps URL showing directions from origin to store location
 */
function getDirections(origin, store) {
	return MAPSURL + `&origin=${origin.lat}, ${origin.long}` + `&destination=${store.lat}, ${store.long}`;
}




/**
 * Fetches a configurable number of stores that are closest to a given coordinate.
 * @param {object} origin - latitude & longitude
 * @param {int} numVals - number of closest stores to return
 * @return {array} - array of the numVal closest stores
 */
function getStoresByCoord(origin, numVals) {
	console.log(`getStoresByCoord(${JSON.stringify(origin)}, ${numVals})`);
	let distances = [];
	
	if (numVals > storeList.length) numVals = storeList.length;

	//performs a haversine dist calc between the origin and each of the stores
	for (let i=0; i < storeList.length; i++) {
		const dist = haversine(origin, {'lat' : storeList[i].lat, 'long' : storeList[i].long});
		const val = {'index': i, 'distance': dist};
		distances.push(val);
	}

	let stores = [];
	distances.sort(compareDist);
	for (let i = 0; i < numVals; i++) {
		stores.push(storeList[distances[i].index]);
	}
	
	return stores;
}

/**
 * Fetches a configurable number of stores that are closest to a given ZIP code.
 * @param {string} zip - ZIP code of user's current location
 * @param {int} numVals - number of closest stores to return
 * @return {array} - array of the numVal closest stores
 */
function getStoresByZip(zip, numVals) {
	console.log(`getStoresByZip(${zip}, ${numVals})`);
	let distances = [];

	if (numVals > storeList.length) numVals = storeList.length;

	//performs a simplistic integer difference between the user's zip code and the zip's of the stores.
	for (let i=0; i < storeList.length; i++) {
		let val = {'index': i, 'distance': Math.abs(parseInt(zip) - parseInt(storeList[i].zip))};
		distances.push(val);
	}
	
	//sort the differences, then push the closest (numVals) to an array
	let stores = [];
	distances.sort(compareDist);
	for (let i = 0; i < numVals; i++) {
		stores.push(storeList[distances[i].index]);
	}
	console.log(stores)
	return stores;
}

/**
 * Pulls the lat/long info for a given ZIP code from a Redis hash set.
 * @param {string} zip - zip code
 * @return {object} - latitude and longitude for the zip code
 */
function getZipCoord(zip) {
	console.log(`getZipCoord(${zip})`);
	return hgetallAsync('zip:' + zip)
	.then(coord => {
		if (coord && coord.lat && coord.long) {
			console.log(`getZipCoord(), coord:${JSON.stringify(coord)}`);
			return coord;
		}
		else {
			throw new Error('zip not found');
		}
	})
	.catch(err => {
		console.error(`getZipCoord(${zip}): ${err}`);
		throw err;
	});
}

/**
 * Performs the Haversine formula to generate the great circle distance between two coordinates.
 * @param {object} coord1 - latitude & longitude
 * @param {object} coord2 - latitude & longitude
 * @return {int} - great circle distance between the two coordinates
 */
function haversine(coord1, coord2) {
	let lat1 = coord1.lat;
	let lon1 = coord1.long;
	let lat2 = coord2.lat;
	let lon2 = coord2.long;
	const R = 3961;  //miles
    const degRad = Math.PI/180;
    const dLat = (lat2-lat1)*degRad;
    const dLon = (lon2-lon1)*degRad;
	
	lat1 *= degRad;
    lat2 *= degRad;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + 
        Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

/**
 * Fetches the store info from Redis and loads them into a global
 * array
 * @return {array} - array of the numVal closest stores
 */
function loadStores() {
	return keysAsync('store:*')
	.then(keys => {
		if (keys) {
			let promises = [];
			for (let key of keys) {
				promises.push(hgetallAsync(key));
			}
			return Promise.all(promises);
		}
		else {
			throw new Error('no store locations found');
		}
	})
	.then(stores => {
		for (const store of stores) {
			storeList.push(store);
		}
		return;
	})
	.catch(err => {
		console.error(`loadStores(): ${err}`);
		throw err;
	});
}

/**
 * Fetches the closest store location based on the user's ZIP code.
 * Performs an initial filtering based ZIP code only, then refines a configurable number of closest
 * stores using actual driving distance from the Google Maps Distance Matrix
 * API.
 * @param {string} zip - ZIP code of user's current location
 * @return {string} - URL of Google map with nearest store
 */
app.get('/locator/zip', (request, response) => {
	let origin;
	getZipCoord(request.query.zip)
	.then(res => {	
		origin = res;	
		const stores = getStoresByZip(request.query.zip, 3);
		return getClosestStore(origin, stores);
	})
	.then(store => {
		const url = getDirections(origin, store);
		response.status(200).send(url);
	})
	.catch(err => {
		response.status(404).send(err.message);
	});
});

/**
 * Fetches the closest store location based on the user's lat/long.
 * @param {string} coordinates - lat/long of user's current location
 * @return {string} - URL of Google map with nearest store
 */
app.get('/locator/coordinates', (request, response) => {
	const vals = request.query.coordinates.split(',');
	const origin = {'lat' : vals[0], 'long' : vals[1]};
	const stores = getStoresByCoord(origin, 3);
	getClosestStore(origin, stores)
	.then(store => {
		const url = getDirections(origin, store);
		response.status(200).send(url);
	})
	.catch(err => {
		response.status(404).send(err.message);
	});
});

app.get('/locator/test', (request, response) => {
	response.status(200).send('successful test');
});

//setInterval(loadStores,1000*60*30);

loadStores()
.then(_ => {
	app.listen(PORT, () => {
		console.log(`Locator service - started on port ${PORT}`);
	})
})
.catch(err => {
	console.error(err);
	process.exit(1);
});
