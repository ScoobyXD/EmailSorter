import { loadConfig } from '../src/config.ts';
import { makeClassifier, PublicError } from '../src/classification.ts';

// Explicit developer verification only: invented fixture text, never Gmail data.
try {
  const config = await loadConfig();
  const classify = makeClassifier(config.apiKey, config.model);
  const result = await classify({
    message: { sender: 'shipping@example.test', subject: 'Your order has shipped', body: 'Your order of replacement printer paper shipped today. Expected delivery is Friday.' },
    categories: [
      { id: 'shipments', title: 'Shipments', description: 'Order shipping and delivery notices for purchased goods.' },
      { id: 'social', title: 'Social', description: 'Personal invitations and conversations with friends.' },
    ],
  }, AbortSignal.timeout(65000));
  console.log(JSON.stringify({ fixture: true, ...result }, null, 2));
  if (result.categoryId !== 'shipments') process.exitCode = 1;
} catch (error) {
  console.error(error instanceof PublicError ? `${error.code}: ${error.message}` : 'Synthetic Jev verification could not run. Configure the helper first.');
  process.exitCode = 1;
}
