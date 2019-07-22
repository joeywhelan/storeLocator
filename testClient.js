/**
 * @fileoverview Test client for a Google endpoints API w/authentication via Auth0
 * @author Joey Whelan <joey.whelan@gmail.com>
 */

/*jshint esversion: 6 */

'use strict';
'use esversion 6';
const fetch = require('node-fetch');
const apiUrl = 'https://yourapp.appspot.com/locator/coordinates/?coordinates=37.1464,-94.4630'
const tokenUrl = 'https://yourapp.com/oauth/token';
const clientId = 'yourId';
const clientSecret = 'yourSecret';
const audience = 'https://yourAud';

function nonAuthTest() {
    return fetch(apiUrl, {
        method: 'GET'
    })
    .then(response => {
        if (response.ok) {
            return response.text();
        }
        else {
            console.error(response.status);
        }
    })
    .then(text => {
        console.log('Response: ' + text);
    })
}

function fetchToken() {

    const body = {
        'client_id': clientId,
        'client_secret': clientSecret,
        'audience': audience,
        'grant_type': 'client_credentials'
    };

    return fetch(tokenUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    })
    .then(response => {
        if (response.ok) {
            return response.json();
        }
        else {
            console.error('fetchToken Error: ' + response.status);
        }
    }) 
    .then(json => {
        return json.access_token;
    })   
}

function authTest() {
    return fetchToken()
    .then(token => {
        fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + token
            }
        })
        .then(response => {
            if (response.ok) {
                return response.text();
            }
            else {
                console.error(response.status);
            }
        })
        .then(text => {
            console.log('Response: ' + text);
        })
    });
}

authTest();
