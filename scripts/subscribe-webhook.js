// scripts/subscribe-webhook.js

const axios = require('axios');

const SHOP_NAME = process.env.SHOP_NAME;
const ADMIN_API_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;
const WEBHOOK_ADDRESS = process.env.WEBHOOK_ADDRESS;
const WEBHOOK_TOPIC = 'ORDERS_CREATE'; // GraphQL Enum value

async function subscribeToWebhook() {
  const endpoint = `https://${SHOP_NAME}.myshopify.com/admin/api/2023-10/graphql.json`;

  // Query to check existing webhooks
  const checkQuery = `
    {
      webhookSubscriptions(first: 100, topics: ${WEBHOOK_TOPIC}) {
        edges {
          node {
            id
            endpoint
          }
        }
      }
    }
  `;

  try {
    // Check for existing webhook subscriptions
    const checkResponse = await axios.post(
      endpoint,
      { query: checkQuery },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
        },
      }
    );

    const existingWebhooks = checkResponse.data.data.webhookSubscriptions.edges;

    // Check if our webhook already exists
    const webhookExists = existingWebhooks.some(webhook => webhook.node.endpoint === WEBHOOK_ADDRESS);

    if (webhookExists) {
      console.log('Webhook subscription already exists.');
      return;
    }

    // Create the webhook subscription
    const createQuery = `
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

    const createResponse = await axios.post(
      endpoint,
      { query: createQuery, variables },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
        },
      }
    );

    const createData = createResponse.data;

    if (createData.errors) {
      console.error('Errors:', JSON.stringify(createData.errors, null, 2));
    } else if (createData.data.webhookSubscriptionCreate.userErrors.length > 0) {
      console.error(
        'User Errors:',
        JSON.stringify(createData.data.webhookSubscriptionCreate.userErrors, null, 2)
      );
    } else {
      console.log(
        'Webhook subscription created with ID:',
        createData.data.webhookSubscriptionCreate.webhookSubscription.id
      );
    }
  } catch (error) {
    console.error('Error subscribing to webhook:', error.response ? error.response.data : error);
  }
}

subscribeToWebhook();
