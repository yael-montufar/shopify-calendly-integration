// functions/shopify-webhook-handler.js

const axios = require('axios');
const crypto = require('crypto');

// Load environment variables
const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY;
const KLAVIYO_LIST_ID = process.env.KLAVIYO_LIST_ID;
const CALENDLY_API_TOKEN = process.env.CALENDLY_API_TOKEN;
const CALENDLY_EVENT_TYPE_URI = process.env.CALENDLY_EVENT_TYPE_URI;
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;

exports.handler = async (event, context) => {
  let schedulingLink; // Declare schedulingLink in the outer scope
  try {
    // Verify that the request is from Shopify
    const hmacHeader = event.headers['x-shopify-hmac-sha256'];
    const body = event.body;

    if (!verifyShopifyWebhook(hmacHeader, body)) {
      return {
        statusCode: 401,
        body: 'Invalid request',
      };
    }

    const order = JSON.parse(body);

    // Extract customer information
    const customerEmail = order.email;
    const firstName = order.customer.first_name;
    const lastName = order.customer.last_name;

    console.log(`Received order from ${firstName} ${lastName} (${customerEmail})`);

    // Create a Calendly scheduling link
    schedulingLink = await createCalendlySchedulingLink({
      email: customerEmail,
      firstName,
      lastName,
    });

    // Add customer to Klaviyo list and send email
    await addToKlaviyoList({
      email: customerEmail,
      firstName,
      lastName,
      schedulingLink,
    });

    return {
      statusCode: 200,
      body: 'Success',
    };
  } catch (error) {
    console.error('Error processing webhook:', error);
    return {
      statusCode: 500,
      body: 'Internal Server Error',
    };
  }
};

// Function to verify Shopify webhook signature
function verifyShopifyWebhook(hmacHeader, body) {
  const generatedHash = crypto
    .createHmac('sha256', SHOPIFY_WEBHOOK_SECRET)
    .update(body, 'utf8')
    .digest('base64');

  return generatedHash === hmacHeader;
}

// Function to create a Calendly scheduling link
async function createCalendlySchedulingLink({ email, firstName, lastName }) {
  try {
    const calendlyResponse = await axios.post(
      'https://api.calendly.com/scheduling_links',
      {
        max_event_count: 1,
        owner: CALENDLY_EVENT_TYPE_URI,
        owner_type: 'EventType', // Added owner_type parameter
        invitee: {
          email,
          first_name: firstName,
          last_name: lastName,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${CALENDLY_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const schedulingLink = calendlyResponse.data.resource.booking_url;
    console.log('Created Calendly scheduling link:', schedulingLink);
    return schedulingLink;
  } catch (error) {
    console.error(
      'Error creating scheduling link via Calendly:',
      JSON.stringify(
        error.response ? error.response.data : error.message,
        null,
        2
      )
    );
    throw new Error('Failed to create Calendly scheduling link');
  }
}

// Function to add customer to Klaviyo list and send email
async function addToKlaviyoList({ email, firstName, lastName, schedulingLink }) {
  try {
    // Subscribe customer to a Klaviyo list
    await axios.post(
      `https://a.klaviyo.com/api/v2/list/${KLAVIYO_LIST_ID}/subscribe`,
      {
        api_key: KLAVIYO_API_KEY,
        profiles: [
          {
            email,
            first_name: firstName,
            last_name: lastName,
            scheduling_link: schedulingLink,
          },
        ],
      },
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('Added customer to Klaviyo list and sent email.');
  } catch (error) {
    console.error(
      'Error adding customer to Klaviyo list:',
      JSON.stringify(
        error.response ? error.response.data : error.message,
        null,
        2
      )
    );
    throw new Error('Failed to add customer to Klaviyo list');
  }
}
