import { serve } from "./server.mjs";
const server = await serve(Number(process.env.PORT || 4173));
console.log(`Preview: ${server.url}/apps/playground/index.html`);
