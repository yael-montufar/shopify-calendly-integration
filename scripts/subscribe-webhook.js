// scripts/subscribe-webhook.js

const axios = require('axios');

const SHOP_NAME = process.env.SHOP_NAME;
const ADMIN_API_ACCESS_TOKEN = process.env.ADMIN_API_ACCESS_TOKEN;
const WEBHOOK_ADDRESS = process.env.WEBHOOK_ADDRESS;
const WEBHOOK_TOPIC = 'ORDERS_CREATE'; // GraphQL Enum value

async function subscribeToWebhook() {
  console.log('Starting webhook subscription process...');
  console.log('Shop Name:', SHOP_NAME);
  console.log('Webhook Address:', WEBHOOK_ADDRESS);
  console.log('Webhook Topic:', WEBHOOK_TOPIC);

  const endpoint = `https://${SHOP_NAME}.myshopify.com/admin/api/2023-10/graphql.json`;

  // Query to check existing webhook subscriptions
  const checkQuery = `
    query webhookSubscriptions($first: Int!, $callbackUrl: URL, $topic: WebhookSubscriptionTopic) {
      webhookSubscriptions(first: $first, callbackUrl: $callbackUrl, topics: [$topic]) {
        edges {
          node {
            id
            callbackUrl
            topic
          }
        }
      }
    }
  `;

  const checkVariables = {
    first: 100,
    callbackUrl: WEBHOOK_ADDRESS,
    topic: WEBHOOK_TOPIC,
  };

  try {
    // Check for existing webhook subscriptions
    const checkResponse = await axios.post(
      endpoint,
      { query: checkQuery, variables: checkVariables },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': ADMIN_API_ACCESS_TOKEN,
        },
      }
    );

    const existingWebhooks = checkResponse.data.data.webhookSubscriptions.edges;

    // Check if our webhook already exists
    const webhookExists = existingWebhooks.some(
      webhook => webhook.node.callbackUrl === WEBHOOK_ADDRESS && webhook.node.topic === WEBHOOK_TOPIC
    );

    if (webhookExists) {
      console.log('Webhook subscription already exists.');
      return;
    }

    console.log('No existing webhook found. Creating a new webhook subscription...');

    // Mutation to create the webhook subscription
    const createQuery = `
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: {callbackUrl: $callbackUrl}) {
          userErrors {
            field
            message
          }
          webhookSubscription {
            id
            topic
            callbackUrl
          }
        }
      }
    `;

    const createVariables = {
      topic: WEBHOOK_TOPIC,
      callbackUrl: WEBHOOK_ADDRESS,
    };

    const createResponse = await axios.post(
      endpoint,
      { query: createQuery, variables: createVariables },
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
        'Webhook subscription created successfully:',
        JSON.stringify(createData.data.webhookSubscriptionCreate.webhookSubscription, null, 2)
      );
    }

    console.log('Webhook subscription process completed.');
  } catch (error) {
    console.error('Error subscribing to webhook:', error.response ? error.response.data : error);
  }
}

subscribeToWebhook();
