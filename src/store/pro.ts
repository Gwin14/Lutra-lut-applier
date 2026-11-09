/**
 * Lutra Pro: RevenueCat purchases and the entitlement every gated feature reads.
 *
 * Purchases exist only in iOS builds. Android has no store products yet and
 * Expo Go has no StoreKit, so both run with Pro unlocked rather than locking
 * features behind a purchase that can't happen.
 */
import Constants from 'expo-constants';
import { router } from 'expo-router';
import Purchases, { type CustomerInfo, type PurchasesOffering, type PurchasesPackage } from 'react-native-purchases';
import { create } from 'zustand';

/** Public SDK key: it is meant to ship inside the app. */
const IOS_API_KEY = 'appl_lWSRyfTpamiBGkJqBlTVgcwUvef';
const ENTITLEMENT = 'pro';

export const purchasesSupported = process.env.EXPO_OS === 'ios' && Constants.executionEnvironment !== 'storeClient';

type ProState = {
  isPro: boolean;
  ready: boolean;
  offering: PurchasesOffering | null;
};

export const useProStore = create<ProState>(() => ({
  isPro: !purchasesSupported,
  ready: !purchasesSupported,
  offering: null,
}));

const applyCustomerInfo = (info: CustomerInfo) => {
  useProStore.setState({ isPro: info.entitlements.active[ENTITLEMENT] !== undefined });
};

let started = false;

export async function initPurchases() {
  if (!purchasesSupported || started) return;
  started = true;
  try {
    Purchases.configure({ apiKey: IOS_API_KEY });
    Purchases.addCustomerInfoUpdateListener(applyCustomerInfo);
    applyCustomerInfo(await Purchases.getCustomerInfo());
  } catch {
    // Offline on a first launch: stays on the free plan until the next launch.
  }
  useProStore.setState({ ready: true });
  loadOffering().catch(() => {});
}

export async function loadOffering() {
  if (!purchasesSupported) return null;
  const offerings = await Purchases.getOfferings();
  useProStore.setState({ offering: offerings.current });
  return offerings.current;
}

export async function isTrialEligible(productId: string) {
  if (!purchasesSupported) return false;
  const result = await Purchases.checkTrialOrIntroductoryPriceEligibility([productId]);
  return result[productId]?.status === Purchases.INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE;
}

/** Resolves true when Pro is active afterwards, false when the user cancelled. */
export async function purchase(pkg: PurchasesPackage) {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    applyCustomerInfo(customerInfo);
    return customerInfo.entitlements.active[ENTITLEMENT] !== undefined;
  } catch (e) {
    if ((e as { userCancelled?: boolean }).userCancelled) return false;
    throw e;
  }
}

/** Resolves true when the restored purchases include Pro. */
export async function restorePurchases() {
  const info = await Purchases.restorePurchases();
  applyCustomerInfo(info);
  return info.entitlements.active[ENTITLEMENT] !== undefined;
}

export function presentPaywall() {
  router.push('/paywall');
}

/** Gate for a Pro action: true means go ahead, false means the paywall opened. */
export function requirePro() {
  const { isPro, ready } = useProStore.getState();
  // The first milliseconds after launch must not show a paywall to a subscriber.
  if (isPro || !ready) return true;
  presentPaywall();
  return false;
}
