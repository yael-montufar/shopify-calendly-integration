// functions/shopify-webhook-handler.js

const axios = require('axios');
const crypto = require('crypto');

exports.handler = async (event, context) => {
  try {
    // Verify that the request is a POST
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }

    // Verify the webhook
    const hmacHeader = event.headers['x-shopify-hmac-sha256'];
    const body = event.body;
    const generatedHash = crypto
      .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET)
      .update(body, 'utf8')
      .digest('base64');

    if (generatedHash !== hmacHeader) {
      return { statusCode: 401, body: 'Unauthorized' };
    }

    const order = JSON.parse(body);
    const customerEmail = order.email;
    const customerFirstName = order.customer.first_name;
    const customerLastName = order.customer.last_name;

    // Check if the purchased product requires scheduling
    const purchasedProductIds = order.line_items.map(item => item.product_id.toString());
    if (!purchasedProductIds.includes(process.env.PRODUCT_ID_REQUIRING_SCHEDULING)) {
      return { statusCode: 200, body: 'No action required' };
    }

    // Generate a unique scheduling link via Calendly API
    const calendlyResponse = await axios.post(
      'https://api.calendly.com/scheduling_links',
      {
        max_event_count: 1,
        owner: process.env.CALENDLY_EVENT_TYPE_URI,
        invitee: {
          email: customerEmail,
          first_name: customerFirstName,
          last_name: customerLastName,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.CALENDLY_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const schedulingLink = calendlyResponse.data.resource.scheduling_url;

    // Send the scheduling link to the customer via Klaviyo
    const klaviyoResponse = await axios.post(
      `https://a.klaviyo.com/api/v2/list/${process.env.KLAVIYO_LIST_ID}/members`,
      {
        profiles: [
          {
            email: customerEmail,
            first_name: customerFirstName,
            last_name: customerLastName,
            scheduling_link: schedulingLink,
          },
        ],
      },
      {
        headers: {
          Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    // Optionally, update the order in Shopify with a note
    const shopifyOrderUpdateUrl = `https://${process.env.SHOP_NAME}.myshopify.com/admin/api/2023-10/orders/${order.id}.json`;

    await axios.put(
      shopifyOrderUpdateUrl,
      {
        order: {
          id: order.id,
          note: `Scheduling link sent to customer via Klaviyo.`,
        },
      },
      {
        auth: {
          username: process.env.SHOPIFY_API_KEY,
          password: process.env.SHOPIFY_API_PASSWORD,
        },
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    return { statusCode: 200, body: 'Webhook processed successfully' };
  } catch (error) {
    console.error('Error processing webhook:', error);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};