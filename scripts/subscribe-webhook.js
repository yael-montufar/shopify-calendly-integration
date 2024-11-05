// scripts/subscribe-webhook.js

const axios = require('axios');

const SHOP_NAME = process.env.SHOP_NAME;
const ADMIN_API_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
const WEBHOOK_ADDRESS = process.env.WEBHOOK_ADDRESS; // Set to your Netlify Function URL
const WEBHOOK_TOPIC = 'ORDERS_CREATE'; // GraphQL Enum value

async function subscribeToWebhook() {
  const endpoint = `https://${SHOP_NAME}.myshopify.com/admin/api/2023-10/graphql.json`;

  const query = `
    mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: {callbackUrl: $callbackUrl}) {
        userErrors {
          field
          message
        }
        webhookSubscription {
          id
        }
      }
    }
  `;

  const variables = {
    topic: WEBHOOK_TOPIC,
    callbackUrl: WEBHOOK_ADDRESS,
  };

  try {
    const response = await axios.post(
      endpoint,
      { query, variables },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
        },
      }
    );

    const data = response.data;

    if (data.errors) {
      console.error('Errors:', JSON.stringify(data.errors, null, 2));
    } else if (data.data.webhookSubscriptionCreate.userErrors.length > 0) {
      console.error(
        'User Errors:',
        JSON.stringify(data.data.webhookSubscriptionCreate.userErrors, null, 2)
      );
    } else {
      console.log(
        'Webhook subscription created with ID:',
        data.data.webhookSubscriptionCreate.webhookSubscription.id
      );
    }
  } catch (error) {
    console.error('Error subscribing to webhook:', error.response ? error.response.data : error);
  }
}

subscribeToWebhook();
