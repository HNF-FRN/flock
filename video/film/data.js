// The film's cast and clock: accounts and sessions (fictional, from Flock's
// preview-mock), what each Claude window shows, and the music's beat grid.
(function () {
  'use strict';

  // "Cat Walk" — Arulo (Mixkit). Grid fitted by tools/beats_np.py: 129.952 BPM.
  const BEAT0 = 0.1507;
  const BEAT = 0.46171;
  const B = (n) => BEAT0 + n * BEAT; // beat n → seconds
  const BAR = (k) => B(4 * k);

  const ACCOUNTS = [
    { id: 'main', name: 'Main', color: '#D97757', kind: 'default', cfg: 'Shared ~/.claude', initial: 'M' },
    { id: 'work', name: 'Work', note: 'Team account', color: '#38BDF8', cfg: 'Own ~/.claude', data: 'Claude-Work', initial: 'W' },
    { id: 'client', name: 'Client A', color: '#4ADE80', cfg: 'Shared ~/.claude', data: 'Claude-Client-A', initial: 'C' },
    { id: 'research', name: 'Research', color: '#C084FC', cfg: '~/.claude with Work', data: 'Claude-Research', initial: 'R' },
    { id: 'side', name: 'Side project', color: '#FACC15', cfg: 'Own ~/.claude', data: 'Claude-Side-project', initial: 'S' },
  ];
  const byId = Object.fromEntries(ACCOUNTS.map((a) => [a.id, a]));

  const SESSIONS = {
    main: [
      { title: 'Hero scroll animation polish', folder: 'studio-site', ago: '4m ago' },
      { title: 'Case study page layout', folder: 'studio-site', ago: '38m ago' },
      { title: 'Fix image loading on mobile', folder: 'studio-site', ago: '2h ago' },
      { title: 'Newsletter signup with double opt-in', folder: 'newsletter', ago: '1d ago' },
      { title: 'Tidy up the README', folder: 'cli-tools', ago: '3d ago' },
    ],
    work: [
      { title: 'Pricing table redesign', folder: 'client-portal', ago: '1m ago' },
      { title: 'Auth middleware refactor', folder: 'client-portal', ago: '17m ago' },
      { title: 'Dashboard charts', folder: 'analytics', ago: '2h ago' },
      { title: 'Release notes for 2.4', folder: 'client-portal', ago: '1d ago' },
    ],
    client: [
      { title: 'Onboarding emails', folder: 'client-a', ago: '2d ago' },
      { title: 'Landing page copy', folder: 'client-a', ago: '4d ago' },
    ],
    research: [
      { title: 'Retrieval eval notes', folder: 'papers', ago: '3h ago' },
      { title: 'Benchmark plots', folder: 'papers', ago: '1d ago' },
    ],
    side: [],
  };

  const code = (...lines) => lines;

  // What each account's Claude window shows (a neutral stand-in, never Claude's own UI).
  const CONTENT = {
    main: {
      side: ['Hero scroll animation polish', 'Case study page layout', 'Fix image loading on mobile', 'Newsletter signup', 'Tidy up the README'],
      heading: 'Hero scroll animation polish',
      ask: 'The hero scroll feels jumpy on trackpads. Can you smooth it out?',
      answer: ['Sure. The jump comes from mixing wheel deltas with scroll snapping. I switched the hero to a spring that follows the scroll position instead:'],
      code: code(
        '<span class="k">const</span> follow = <span class="f">spring</span>({ stiffness: <span class="n">180</span>, damping: <span class="n">26</span> });',
        'window.<span class="f">addEventListener</span>(<span class="s">\'scroll\'</span>, () =&gt; {',
        '  follow.<span class="f">to</span>(scrollY / heroHeight);',
        '});',
      ),
      after: ['Trackpads and wheels now land on the same curve. I also kept the reduced-motion fallback.'],
      me: 'You', initial: 'Y',
    },
    work: {
      side: ['Pricing table redesign', 'Auth middleware refactor', 'Dashboard charts', 'Release notes for 2.4'],
      heading: 'Pricing table redesign',
      ask: 'Add a yearly toggle to the pricing table and keep it responsive.',
      answer: ['Done. The toggle switches every plan at once and the table stacks into cards below 720 px.'],
      code: code(
        '<span class="k">export function</span> <span class="f">PricingTable</span>({ plans }) {',
        '  <span class="k">const</span> [yearly, setYearly] = <span class="f">useState</span>(<span class="k">false</span>);',
        '  <span class="k">return</span> &lt;<span class="f">Grid</span> stackBelow={<span class="n">720</span>}&gt;…&lt;/<span class="f">Grid</span>&gt;;',
        '}',
      ),
      after: ['Yearly prices show the saving as a small badge, so the column widths stay steady.'],
      me: 'You', initial: 'Y',
    },
    workAuth: {
      side: ['Auth middleware refactor', 'Pricing table redesign', 'Dashboard charts', 'Release notes for 2.4'],
      heading: 'Auth middleware refactor',
      ask: 'Split the auth middleware so API routes and pages can use it separately.',
      answer: ['I moved token checks into verifySession() and kept the redirect logic for pages only:'],
      code: code(
        '<span class="k">export async function</span> <span class="f">verifySession</span>(req) {',
        '  <span class="k">const</span> token = req.cookies.<span class="f">get</span>(<span class="s">\'session\'</span>);',
        '  <span class="k">return</span> token ? <span class="f">decode</span>(token) : <span class="k">null</span>;',
        '}',
      ),
      after: ['API routes now answer 401 instead of redirecting. All 48 auth tests pass.'],
      me: 'You', initial: 'Y',
    },
    client: {
      side: ['Onboarding emails', 'Landing page copy'],
      heading: 'Onboarding emails',
      ask: 'Draft a three-email welcome sequence for new trial users.',
      answer: ['Here’s a sequence that moves from setup to first win:', 'Day 0 — Welcome: one link to finish setup, nothing else.', 'Day 2 — First win: a 3-step checklist with a short screen recording.', 'Day 5 — Check-in: ask what they are trying to do, reply goes to a person.'],
      after: ['Want me to write the subject lines next?'],
      me: 'You', initial: 'Y',
    },
    research: {
      side: ['Retrieval eval notes', 'Benchmark plots'],
      heading: 'Retrieval eval notes',
      ask: 'Compare how the three papers evaluate retrieval quality.',
      answer: ['All three report recall@k, but they disagree on what counts as relevant:', '• Paper A uses human labels on 2,000 queries.', '• Paper B uses click logs, so popular pages dominate.', '• Paper C mixes both and reports each separately.'],
      after: ['C’s split makes it the easiest to compare against.'],
      me: 'You', initial: 'Y',
    },
    side: {
      side: [],
      heading: 'New session',
      ask: '',
      answer: [],
      me: 'You', initial: 'Y',
    },
  };

  window.Cast = { BEAT0, BEAT, B, BAR, ACCOUNTS, byId, SESSIONS, CONTENT };
})();
