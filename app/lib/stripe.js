import Stripe from 'stripe';
import { loadStripe } from '@stripe/stripe-js';

let stripeInstance = null;
let stripePromise = null;

export function getStripe() {
  if (!stripeInstance) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('[stripe] Missing env var: STRIPE_SECRET_KEY');
    }

    stripeInstance = new Stripe(secretKey);
  }

  return stripeInstance;
}

export const stripe = new Proxy({}, {
  get(_target, prop) {
    return getStripe()[prop];
  },
});

export function getStripePriceId(planType) {
  if (planType === 'starter') return process.env.STRIPE_STARTER_PRICE_ID;
  if (planType === 'pro') return process.env.STRIPE_PRO_PRICE_ID;
  return null;
}

export function getPlanTypeFromPriceId(priceId) {
  if (priceId === process.env.STRIPE_STARTER_PRICE_ID) return 'starter';
  if (priceId === process.env.STRIPE_PRO_PRICE_ID) return 'pro';
  return null;
}

export function loadStripeClient() {
  if (!stripePromise) {
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

    if (!publishableKey) {
      throw new Error('[stripe] Missing env var: NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY');
    }

    stripePromise = loadStripe(publishableKey);
  }

  return stripePromise;
}

export { loadStripe };
