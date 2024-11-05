// functions/shopify-webhook-handler.js

const axios = require('axios');
const crypto = require('crypto');

// Load environment variables
const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY;
const CALENDLY_API_TOKEN = process.env.CALENDLY_API_TOKEN;
const CALENDLY_EVENT_TYPE_URI = process.env.CALENDLY_EVENT_TYPE_URI;
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;
const ADMIN_API_ACCESS_TOKEN = process.env.ADMIN_API_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;

exports.handler = async (event, context) => {
  let schedulingLink;
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

    // Track a custom event in Klaviyo
    await trackKlaviyoEvent({
      email: customerEmail,
      firstName,
      lastName,
      schedulingLink,
      orderId: order.id,
      orderTime: order.created_at,
    });

    // Add the scheduling link to the order notes
    await addNoteToShopifyOrder({
        orderId: orderId,
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
        owner_type: 'EventType',
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

// Function to track a custom event in Klaviyo
async function trackKlaviyoEvent({
  email,
  firstName,
  lastName,
  schedulingLink,
  orderId,
  orderTime,
}) {
  try {
    // Ensure orderTime is in the correct format
    const eventTime = new Date(orderTime).toISOString(); // Converts to 'YYYY-MM-DDTHH:MM:SSZ' format

    await axios.post(
      'https://a.klaviyo.com/api/events/',
      {
        data: {
          type: 'event',
          attributes: {
            metric: {
              data: {
                type: 'metric',
                attributes: {
                  name: 'Purchase with Scheduling Link',
                },
              },
            },
            profile: {
              data: {
                type: 'profile',
                attributes: {
                  email: email,
                  first_name: firstName,
                  last_name: lastName,
                },
              },
            },
            properties: {
              scheduling_link: schedulingLink,
              order_id: orderId,
            },
            time: eventTime, // Use the correctly formatted date string
          },
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
          revision: '2023-07-15',
        },
      }
    );
    console.log('Tracked Klaviyo event for purchase.');
  } catch (error) {
    console.error(
      'Error tracking Klaviyo event:',
      JSON.stringify(
        error.response ? error.response.data : error.message,
        null,
        2
      )
    );
    throw new Error('Failed to track Klaviyo event');
  }
}



// Function to add a note to the Shopify order
async function addNoteToShopifyOrder({ orderId, schedulingLink }) {
    try {
      // Update the order with the scheduling link in the note attributes
      await axios.put(
        `https://${SHOPIFY_STORE_URL}/admin/api/2023-10/orders/${orderId}.json`,
        {
          order: {
            id: orderId,
            note: `Scheduling Link: ${schedulingLink}`,
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
          },
        }
      );
      console.log('Added scheduling link to Shopify order notes.');
    } catch (error) {
      console.error(
        'Error adding note to Shopify order:',
        JSON.stringify(
          error.response ? error.response.data : error.message,
          null,
          2
        )
      );
      throw new Error('Failed to add note to Shopify order');
    }
  }