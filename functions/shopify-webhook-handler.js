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
  try {
    // Step 1: Get user URI
    const userResponse = await axios.get('https://api.calendly.com/users/me', {
      headers: { Authorization: `Bearer ${CALENDLY_API_TOKEN}` },
    });
    const userUri = userResponse.data.resource.uri;

    // Step 2: Fetch event types associated with the user URI
    const eventsResponse = await axios.get('https://api.calendly.com/event_types', {
      params: { user: userUri },
      headers: { Authorization: `Bearer ${CALENDLY_API_TOKEN}` },
    });

    // Step 3: Find the event type with the matching slug
    const eventType = eventsResponse.data.collection.find(
      (event) => event.slug === eventHandle
    );

    return eventType ? eventType.uri : null;
  } catch (error) {
    console.error(
      'Error retrieving Calendly event type URI:',
      JSON.stringify(error.response ? error.response.data : error.message, null, 2)
    );
    return null;
  }
}

// Function to create Calendly scheduling link
async function createCalendlySchedulingLink({ email, firstName, lastName, eventTypeUri }) {
  try {
    const calendlyResponse = await axios.post(
      'https://api.calendly.com/scheduling_links',
      {
        max_event_count: 1,
        owner: eventTypeUri,
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
      JSON.stringify(error.response ? error.response.data : error.message, null, 2)
    );
    throw new Error('Failed to create Calendly scheduling link');
  }
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
  try {
    const eventTime = new Date(orderTime).toISOString();

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
                  name: 'Purchase with Scheduling Links',
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
              scheduling_links: schedulingLinks, // Pass the array of links
              order_id: orderId,
            },
            time: eventTime,
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
    console.log('Tracked Klaviyo event for purchase with multiple scheduling links.');
  } catch (error) {
    console.error(
      'Error tracking Klaviyo event:',
      JSON.stringify(error.response ? error.response.data : error.message, null, 2)
    );
    throw new Error('Failed to track Klaviyo event');
  }
}

// Function to add a note with multiple scheduling links to the Shopify order
async function addNoteToShopifyOrder({ orderId, schedulingLinks }) {
  try {
    const notes = schedulingLinks
      .map((link) => `${link.title}: ${link.link}`)
      .join('\n');

    await axios.put(
      `https://${SHOPIFY_STORE_URL}/admin/api/2023-10/orders/${orderId}.json`,
      {
        order: {
          id: orderId,
          note: `Scheduling Links:\n${notes}`,
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
        },
      }
    );
    console.log('Added multiple scheduling links to Shopify order notes.');
  } catch (error) {
    console.error(
      'Error adding note to Shopify order:',
      JSON.stringify(error.response ? error.response.data : error.message, null, 2)
    );
    throw new Error('Failed to add note to Shopify order');
  }
}
