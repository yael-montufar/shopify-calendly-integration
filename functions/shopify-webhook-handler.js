const axios = require('axios');
const crypto = require('crypto');

const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY;
const CALENDLY_API_TOKEN = process.env.CALENDLY_API_TOKEN;
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET;
const ADMIN_API_ACCESS_TOKEN = process.env.ADMIN_API_ACCESS_TOKEN;
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;

exports.handler = async (event, context) => {
  try {
    const hmacHeader = event.headers['x-shopify-hmac-sha256'];
    const body = event.body;

    if (!verifyShopifyWebhook(hmacHeader, body)) {
      return { statusCode: 401, body: 'Invalid request' };
    }

    const order = JSON.parse(body);
    const customerEmail = order.email;
    const firstName = order.customer.first_name;
    const lastName = order.customer.last_name;

    console.log(`Received order from ${firstName} ${lastName} (${customerEmail})`);

    let schedulingLinks = []; // Array to hold all scheduling links

    for (const lineItem of order.line_items) {
      const productId = lineItem.product_id;
      const quantity = lineItem.quantity; // Number of times the event was purchased

      const eventHandle = await getCalendlyEventHandle(productId);

      if (eventHandle) {
        console.log(`Product ${lineItem.title} has a Calendly event handle: ${eventHandle}`);

        // Get the Calendly Event Type URI based on the handle
        const eventTypeUri = await getCalendlyEventTypeUri(eventHandle);

        if (eventTypeUri) {
          // Generate a unique link for each item in the quantity
          for (let i = 0; i < quantity; i++) {
            const schedulingLink = await createCalendlySchedulingLink({
              email: customerEmail,
              firstName,
              lastName,
              eventTypeUri,
            });

            schedulingLinks.push({ title: `${lineItem.title} (Ticket ${i + 1})`, link: schedulingLink });
          }
        } else {
          console.warn(`No matching event found for handle: ${eventHandle}`);
        }
      }
    }

    // Track the event in Klaviyo with all scheduling links
    if (schedulingLinks.length > 0) {
      await trackKlaviyoEvent({
        email: customerEmail,
        firstName,
        lastName,
        schedulingLinks,
        orderId: order.id,
        orderTime: order.created_at,
      });

      // Add all scheduling links to Shopify order notes
      await addNoteToShopifyOrder({
        orderId: order.id,
        schedulingLinks,
      });
    }

    return { statusCode: 200, body: 'Success' };
  } catch (error) {
    console.error('Error processing webhook:', error);
    return { statusCode: 500, body: 'Internal Server Error' };
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

// Updated function to retrieve the Calendly event handle from metaobject
async function getCalendlyEventHandle(productId) {
  try {
    // Step 1: Get the 'custom.event' metafield from the product
    const response = await axios.get(
      `https://${SHOPIFY_STORE_URL}/admin/api/2023-10/products/${productId}/metafields.json?namespace=custom&key=event`,
      {
        headers: { 'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN },
      }
    );

    const metafields = response.data.metafields;
    if (!metafields || metafields.length === 0) {
      console.log(`No 'custom.event' metafield found for product ${productId}`);
      return null;
    }

    const metafield = metafields[0]; // Should be only one
    const metaobjectId = metafield.value; // This is a GID, e.g., 'gid://shopify/Metaobject/123456789'

    // Step 2: Use GraphQL to fetch the metaobject by ID
    const graphqlEndpoint = `https://${SHOPIFY_STORE_URL}/admin/api/2023-10/graphql.json`;

    const query = `
    query getMetaobject($id: ID!) {
      metaobject(id: $id) {
        fields {
          key
          value
        }
      }
    }`;

    const variables = { id: metaobjectId };

    const graphqlResponse = await axios.post(
      graphqlEndpoint,
      { query, variables },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
        },
      }
    );

    const metaobjectData = graphqlResponse.data;

    if (metaobjectData.errors) {
      console.error('Error fetching metaobject:', metaobjectData.errors);
      return null;
    }

    if (!metaobjectData.data || !metaobjectData.data.metaobject) {
      console.error('Metaobject data not found');
      return null;
    }

    const fields = metaobjectData.data.metaobject.fields;
    const calendlyField = fields.find(
      (field) => field.key === 'calendly_event_url_handle'
    );

    return calendlyField ? calendlyField.value : null;
  } catch (error) {
    console.error(
      'Error fetching Calendly event handle from metaobject:',
      JSON.stringify(error.response ? error.response.data : error.message, null, 2)
    );
    return null;
  }
}

// Function to get Calendly Event Type URI based on event handle
async function getCalendlyEventTypeUri(eventHandle) {
  // (Unchanged from previous code)
}

// Function to create Calendly scheduling link
async function createCalendlySchedulingLink({ email, firstName, lastName, eventTypeUri }) {
  // (Unchanged from previous code)
}

// Function to track a custom event in Klaviyo
async function trackKlaviyoEvent({
  email,
  firstName,
  lastName,
  schedulingLinks,
  orderId,
  orderTime,
}) {
  // (Unchanged from previous code)
}

// Function to add a note with multiple scheduling links to the Shopify order
async function addNoteToShopifyOrder({ orderId, schedulingLinks }) {
  // (Unchanged from previous code)
}
