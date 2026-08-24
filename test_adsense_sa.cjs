const { google } = require('googleapis');

async function test() {
    console.log("Testing AdSense API...");
    try {
        const auth = new google.auth.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/adsense.readonly']
        });
        const client = google.adsense({ version: 'v2', auth });
        console.log("Client created successfully with default auth.");
    } catch (e) {
        console.error("Error creating client:", e);
    }
}
test();
