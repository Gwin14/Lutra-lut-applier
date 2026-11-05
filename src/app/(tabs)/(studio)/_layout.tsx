import { useT } from '../../../i18n';
import { TabStack } from '../../../ui/TabStack';

export default function Layout() {
  return <TabStack title={useT().tabs.studio} />;
}
