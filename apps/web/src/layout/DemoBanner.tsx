/**
 * Public-demo mode (`VITE_NETPLAN_DEMO=1` at build time): the hosted sandbox
 * at reallywire.dev is shared by every visitor and wiped on a schedule, so
 * say so up front (in Norwegian, like the rest of reallywire.dev) and point back to the product page.
 */
export const DEMO_MODE = import.meta.env.VITE_NETPLAN_DEMO === '1';

const HOME_URL =
  String(import.meta.env.VITE_NETPLAN_HOME_URL ?? '') || 'https://reallywire.dev/netplan-studio';

export function DemoBanner() {
  return (
    <div className="demo-banner" role="note" data-testid="demo-banner">
      <span>
        <strong>NetPlan Studio</strong> fra reallywire — offentlig demo. Alle besøkende deler denne
        sandkassen, og den nullstilles hvert døgn. Ikke legg inn ekte nettverksdata.
      </span>
      <a className="demo-banner__link" href={HOME_URL}>
        Om NetPlan Studio →
      </a>
    </div>
  );
}
