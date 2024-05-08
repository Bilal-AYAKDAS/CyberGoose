const { google } = require('googleapis');

const { OAuth2 } = google.auth;

// Set up OAuth 2.0 client credentials
const CLIENT_ID = 'YOUR_CLIENT_ID';
const CLIENT_SECRET = 'YOUR_CLIENT_SECRET';
const REDIRECT_URI = 'YOUR_REDIRECT_URI';

// Create an OAuth2 client
const oAuth2Client = new OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

// Generate the URL for user authorization
const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive'],
});

// Redirect the user to the authorization URL
console.log('Please authorize this app by visiting the following URL:');
console.log(authUrl);

// After the user authorizes the app, they will be redirected back to your specified redirect URI
// You can handle the redirect URI to obtain the authorization code and exchange it for access and refresh tokens

// Once you have the access and refresh tokens, you can use them to perform transactions in the user's Google Drive account
// For example, you can use the access token to make API requests like listing files, uploading files, etc.

// Remember to store and securely manage the access and refresh tokens for future use