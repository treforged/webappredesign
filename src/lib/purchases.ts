/**
 * RevenueCat SDK wrapper — iOS and Android native only.
 *
 * All exports are safe to import on web. Guards prevent the SDK from
 * initialising or being called outside of a native context.
 */
import { Capacitor } from '@capacitor/core';

import type {
  CustomerInfo,
  PurchasesOfferings,
  PurchasesPackage,
} from '@revenuecat/purchases-capacitor';

const isNative = (): boolean => Capacitor.isNativePlatform();

/**
 * WHICH user the SDK is currently configured for, not merely THAT it is.
 *
 * ⚠️ A bare boolean latch was wrong in a way that only shows up on money. `configure` is what
 * ties a purchase to a person, so a second user arriving while the latch was still true would
 * have had their entitlements attached to the FIRST user's RevenueCat customer. Holding the id
 * makes "already configured" mean "already configured FOR THIS PERSON", which is the only
 * version of that question worth asking.
 */
let configuredUserId: string | null = null;

/** Test seam and sign-out reset. Not part of the public surface. */
export function __resetRevenueCatForTests(): void {
  configuredUserId = null;
}

/** Whether the SDK is ready to be called. Purchases silently no-op without it. */
export function isRevenueCatConfigured(): boolean {
  return configuredUserId !== null;
}

export async function initRevenueCat(userId: string): Promise<void> {
  if (!isNative()) return;
  if (configuredUserId === userId) return;
  // A DIFFERENT user on an already-configured SDK: hang up first, or their purchases land on
  // the previous customer. logOut is what returns the SDK to a state configure can claim.
  if (configuredUserId !== null) {
    try {
      const { Purchases } = await import('@revenuecat/purchases-capacitor');
      await Purchases.logOut();
    } catch {
      // Best effort. Configuring for the right user matters more than a clean hang-up.
    }
    configuredUserId = null;
  }

  const platform = Capacitor.getPlatform();
  const apiKey = platform === 'ios'
    ? (import.meta.env.VITE_REVENUECAT_IOS_API_KEY as string | undefined)
    : (import.meta.env.VITE_REVENUECAT_ANDROID_API_KEY as string | undefined);

  if (!apiKey) {
    console.warn(`[RevenueCat] VITE_REVENUECAT_${platform.toUpperCase()}_API_KEY not set — IAP disabled`);
    return;
  }

  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  await Purchases.configure({ apiKey, appUserID: userId });
  configuredUserId = userId;
}

/**
 * ⚠️ `Purchases.logIn()` IS DELIBERATELY NEVER CALLED, AND ADDING IT IS NOT A FIX.
 *
 * A previous handoff recorded "logIn() is never called" as a money-path defect — that a purchase
 * made while unidentified would not alias to the account on sign-in, abandoning the anonymous
 * customer. Checked 2026-09-06 against the code rather than re-derived, and the premise is FALSE:
 *
 *  - `configure` above is only ever reached with a real `userId`, from `AuthContext` on
 *    `SIGNED_IN || INITIAL_SESSION`. The SDK is never configured anonymously by this app.
 *  - Every purchase entry point — `getOfferings`, `purchasePackage`, `restorePurchases` — returns
 *    null while `configuredUserId === null`. So a purchase CANNOT be made before identification.
 *
 * `logIn` exists for apps that configure anonymously and identify later. This one identifies
 * first, so passing `appUserID` to `configure` is the correct pattern and `logIn` would be a no-op
 * at best. Do not "fix" this.
 *
 * ⚠️ WHAT IS STILL UNEXPLAINED, and it is a DATA question, not a code one: the 2026-09-05 baseline
 * found 172 RevenueCat customers overwhelmingly keyed `$RCAnonymousID:`. Nothing above can produce
 * one. The likely sources are customers created before the `INITIAL_SESSION` fix, or the native SDK
 * self-initialising outside this JS path — but that is a guess and should be MEASURED before anyone
 * acts on it. Do not conclude from that ratio that the code here is wrong.
 */

export async function getOfferings(): Promise<PurchasesOfferings | null> {
  if (!isNative() || configuredUserId === null) return null;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  return Purchases.getOfferings();
}

export async function purchasePackage(
  pkg: PurchasesPackage,
): Promise<CustomerInfo | null> {
  if (!isNative() || configuredUserId === null) return null;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
  return customerInfo;
}

export async function restorePurchases(): Promise<CustomerInfo | null> {
  if (!isNative() || configuredUserId === null) return null;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  const { customerInfo } = await Purchases.restorePurchases();
  return customerInfo;
}

export async function logOutRevenueCat(): Promise<void> {
  if (!isNative() || configuredUserId === null) return;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  await Purchases.logOut();
  configuredUserId = null;
}

export async function presentCodeRedemptionSheet(): Promise<void> {
  if (!isNative() || configuredUserId === null) return;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  await Purchases.presentCodeRedemptionSheet();
}

export async function openAndroidOfferRedemption(): Promise<void> {
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url: 'https://play.google.com/redeem' });
}

export type { CustomerInfo, PurchasesOfferings, PurchasesPackage };
