import * as Linking from 'expo-linking';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PurchasesPackage } from 'react-native-purchases';

import { useT } from '../i18n';
import { haptic } from '../lib/haptics';
import { privacyUrl, TERMS_URL } from '../lib/links';
import { isTrialEligible, loadOffering, purchase, restorePurchases, useProStore } from '../store/pro';
import { radius, space } from '../theme/tokens';
import { usePalette } from '../theme/useTheme';
import { Button } from '../ui/Button';
import { Icon, type IconName } from '../ui/Icon';
import { PressableScale } from '../ui/Pressable';
import { Text } from '../ui/Text';

const FEATURE_ICONS: IconName[] = ['exports', 'engine', 'import', 'scopes'];

function PlanRow({ title, price, detail, badge, selected, onPress }: { title: string; price: string; detail?: string; badge?: string; selected: boolean; onPress: () => void }) {
  const c = usePalette();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.m,
        padding: space.l,
        borderRadius: radius.card,
        borderCurve: 'continuous',
        borderWidth: 2,
        borderColor: selected ? c.accent : c.separator,
        backgroundColor: c.surface,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <Text variant="headline">{title}</Text>
          {badge ? (
            <View style={{ paddingHorizontal: space.s, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: c.accent }}>
              <Text variant="footnote" color={c.onAccent}>{badge}</Text>
            </View>
          ) : null}
        </View>
        {detail ? <Text variant="footnote" tone="secondary">{detail}</Text> : null}
      </View>
      <Text variant="headline" tabular>{price}</Text>
    </PressableScale>
  );
}

export default function PaywallScreen() {
  const t = useT();
  const p = t.pro;
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const offering = useProStore((s) => s.offering);
  const isPro = useProStore((s) => s.isPro);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<PurchasesPackage | null>(null);
  const [trial, setTrial] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (offering) return;
    loadOffering().then((o) => setFailed(!o)).catch(() => setFailed(true));
  }, [offering]);

  const plans = useMemo(() => [offering?.annual, offering?.monthly, offering?.lifetime].filter((x): x is PurchasesPackage => !!x), [offering]);
  const annual = offering?.annual ?? null;
  const current = selected ?? annual ?? plans[0] ?? null;
  const annualProduct = annual?.product.identifier;

  useEffect(() => {
    if (!annualProduct) return;
    isTrialEligible(annualProduct).then(setTrial).catch(() => setTrial(false));
  }, [annualProduct]);

  useEffect(() => {
    if (isPro && router.canGoBack()) router.back();
  }, [isPro]);

  const showsTrial = trial && !!annual && current?.identifier === annual.identifier;

  const buy = async () => {
    if (!current) return;
    setBusy(true);
    try {
      if (await purchase(current)) haptic.success();
    } catch (e) {
      haptic.error();
      Alert.alert(p.purchaseFailed, (e as Error).message);
    }
    setBusy(false);
  };

  const restore = async () => {
    setBusy(true);
    try {
      const restored = await restorePurchases();
      if (restored) haptic.success();
      else Alert.alert(p.nothingToRestore, p.nothingToRestoreBody);
    } catch (e) {
      haptic.error();
      Alert.alert(p.purchaseFailed, (e as Error).message);
    }
    setBusy(false);
  };

  const planDetail = (pkg: PurchasesPackage) => {
    if (pkg.identifier === annual?.identifier) return pkg.product.pricePerMonthString ? p.perMonth(pkg.product.pricePerMonthString) : undefined;
    if (pkg.packageType === 'LIFETIME') return p.oneTime;
    return p.cancelAnytime;
  };
  const planTitle = (pkg: PurchasesPackage) => (pkg.packageType === 'ANNUAL' ? p.annual : pkg.packageType === 'MONTHLY' ? p.monthly : p.lifetime);
  const legal = current?.packageType === 'LIFETIME' ? p.legalLifetime : showsTrial ? p.legalTrial(current?.product.priceString ?? '') : p.legalSubscription;

  return (
    <>
      <Stack.Screen options={{ title: '', headerLeft: () => <Button label={t.common.close} variant="plain" size="small" onPress={() => router.back()} /> }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l, gap: space.xl, paddingBottom: insets.bottom + space.xl }}>
        <View style={{ gap: space.s }}>
          <Text variant="title1">{p.title}</Text>
          <Text variant="body" tone="secondary">{p.subtitle}</Text>
        </View>

        <View style={{ gap: space.m }}>
          {p.features.map((feature, i) => (
            <View key={feature} style={{ flexDirection: 'row', alignItems: 'center', gap: space.m }}>
              <Icon name={FEATURE_ICONS[i]} size={22} color={c.accentText} />
              <Text variant="body" style={{ flex: 1 }}>{feature}</Text>
            </View>
          ))}
        </View>

        {plans.length ? (
          <View style={{ gap: space.m }}>
            {plans.map((pkg) => (
              <PlanRow
                key={pkg.identifier}
                title={planTitle(pkg)}
                price={pkg.product.priceString}
                detail={planDetail(pkg)}
                badge={pkg.identifier === annual?.identifier ? p.bestValue : undefined}
                selected={pkg.identifier === current?.identifier}
                onPress={() => {
                  haptic.selection();
                  setSelected(pkg);
                }}
              />
            ))}
          </View>
        ) : failed ? (
          <Text variant="subhead" tone="secondary" center>{p.loadFailed}</Text>
        ) : (
          <ActivityIndicator />
        )}

        <View style={{ gap: space.m }}>
          <Button label={showsTrial ? p.startTrial : p.continue} size="large" stretch loading={busy} disabled={!current} onPress={buy} />
          <Button label={p.restore} variant="plain" size="small" disabled={busy} onPress={restore} />
          <Text variant="footnote" tone="tertiary" center>{legal}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.l }}>
            <Button label={p.terms} variant="plain" size="small" onPress={() => Linking.openURL(TERMS_URL)} />
            <Button label={p.privacy} variant="plain" size="small" onPress={() => Linking.openURL(privacyUrl())} />
          </View>
        </View>
      </ScrollView>
    </>
  );
}
