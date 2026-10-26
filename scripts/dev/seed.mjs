// Replaces local development D1/R2 with synthetic members, posts, and comments.
// Local only: never pass --remote or --env here.
import { unstable_startWorker } from 'wrangler';
import { makeSignature } from 'better-auth/crypto';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import assert from 'node:assert/strict';

const origin = 'http://localhost:8787';
const photoDir = '.wrangler/seed-photos';
const sqlFile = '.wrangler/seed.sql';

const vars = Object.fromEntries(
  (await readFile('.dev.vars', 'utf8'))
    .split('\n')
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [
      line.slice(0, line.indexOf('=')),
      line.slice(line.indexOf('=') + 1),
    ]),
);
assert(vars.AUTH_SECRET, 'Set AUTH_SECRET in .dev.vars.');
assert(vars.BOOTSTRAP_EMAIL, 'Set BOOTSTRAP_EMAIL in .dev.vars.');

const inUse = await new Promise((resolve) => {
  const socket = connect(8787, 'localhost', () => {
    socket.end();
    resolve(true);
  }).on('error', () => resolve(false));
});
assert(!inUse, 'Port 8787 is in use. Stop `npm run dev` before seeding.');

// The bootstrap member is the root; everyone else joins through a personal
// invitation, whose trigger makes inviter and invitee follow each other.
const members = [
  {
    id: 'seed-root',
    email: vars.BOOTSTRAP_EMAIL.trim(),
    handle: 'alex',
    name: 'Alex',
    bio: 'Mostly dogs.',
  },
  ['maya', 'Maya Chen', 'root', 'Two corgis, zero chill.'],
  ['jonah', 'Jonah Park', 'root', 'Weekend hikes with Biscuit.'],
  ['priya', 'Priya Nair', 'root', 'Foster mom. Currently: four.'],
  ['theo', 'Theo Grant', 'maya', ''],
  ['lena', 'Lena Ortiz', 'maya', 'Beach dog enthusiast.'],
  ['sam', 'Sam Okafor', 'jonah', 'Puppy class dropout (the puppy, not me).'],
  ['nora', 'Nora Lind', 'priya', ''],
  ['rafael', 'Rafael Diaz', 'nora', 'New here.'],
].map((m) =>
  Array.isArray(m)
    ? {
        id: `seed-${m[0]}`,
        email: `${m[0]}@example.invalid`,
        handle: m[0],
        name: m[1],
        inviter: `seed-${m[2]}`,
        bio: m[3],
      }
    : m,
);
// Follows beyond the invitation tree: [follower, target, accepted].
const follows = [
  ['alex', 'theo', true],
  ['alex', 'lena', true],
  ['theo', 'jonah', true],
  ['jonah', 'theo', true],
  ['lena', 'priya', true],
  ['priya', 'lena', true],
  ['sam', 'maya', true],
  ['maya', 'sam', true],
  ['nora', 'theo', true],
  ['rafael', 'alex', false],
  ['sam', 'alex', false],
];
const captions = [
  'First day home.',
  'He found the one sunny spot in the apartment.',
  'Bath day. Nobody is happy about it.',
  'Trail mix: dog, mud, more mud.',
  'Caught mid-zoomie.',
  'This is the face of someone who ate a sock.',
  'Park regulars.',
  'Nap #4 of the day.',
  '',
  'She learned "sit." Only on Tuesdays.',
  'Waiting very patiently for dinner.',
  'Beach day!',
  'New harness, same chaos.',
  'Rainy walk survivor.',
  'Borrowed my friend’s dog for the afternoon.',
  '',
  'Grooming appointment glow-up.',
  'Squirrel spotted. Brain offline.',
];
const comments = [
  'Oh my god.',
  'I need to meet this dog immediately.',
  'Those ears!',
  'Look at that face.',
  'Bring him to the park Saturday?',
  'This made my day.',
  'The side-eye is perfect.',
  'How old is she now?',
  'Haha the sock thing is so real.',
  'Absolute menace. Love it.',
  'So fluffy.',
  'We were just there yesterday!',
  'Tiny paws 😭',
  'Good dog.',
];
// Events give the bootstrap member every relationship the Events tab shows:
// hosting with a co-host, co-hosting, answered, invited (link opened only),
// asked to co-host, cancelled, and past. Days are relative to today;
// answers map handles to going, maybe, or declined.
const zone = 'America/Los_Angeles';
const seedEvents = [
  {
    host: 'alex',
    cohost: 'maya',
    title: 'Saturday dog park meetup',
    description:
      'Bring a ball and a towel. We’ll grab coffee after if the dogs are tired enough.',
    location: 'Volunteer Park, off-leash area',
    days: 5,
    hour: 10,
    hours: 2,
    colorTheme: 'after-hours',
    fontPairing: 'classic',
    answers: {
      maya: 'going',
      jonah: 'going',
      priya: 'maybe',
      lena: 'declined',
    },
    messages: [
      ['jonah', 'Biscuit is already packed.'],
      ['priya', 'Might bring one of the fosters!'],
    ],
  },
  {
    host: 'maya',
    title: 'Corgi birthday party',
    description:
      'Pupcakes at 3. Hats are optional for humans and strongly encouraged for dogs.',
    location: 'Maya’s backyard',
    days: 9,
    hour: 15,
    hours: 3,
    colorTheme: 'cherry',
    fontPairing: 'handwritten',
    answers: { alex: 'going', theo: 'going', lena: 'maybe', sam: 'going' },
    messages: [
      ['alex', 'Wouldn’t miss it.'],
      ['maya', 'Parking is on the street out front.'],
    ],
  },
  {
    host: 'priya',
    title: 'Foster adoption day',
    description: 'Four very good dogs looking for homes. Come say hi.',
    location: 'Ballard Community Center',
    days: 14,
    hour: 11,
    hours: 4,
    colorTheme: 'citrus',
    fontPairing: 'original',
    invited: ['alex'],
    answers: { nora: 'going', rafael: 'maybe' },
  },
  {
    host: 'jonah',
    askToHost: 'alex',
    title: 'Rattlesnake Ledge hike',
    description: 'Moderate pace, leashes required on the trail.',
    location: 'Rattlesnake Lake trailhead',
    days: 20,
    hour: 8,
    hours: 5,
    colorTheme: 'evergreen',
    fontPairing: 'rubik-wet-paint',
    answers: { sam: 'going' },
  },
  {
    host: 'theo',
    cancel: true,
    title: 'Candlelit pup dinner',
    description: 'Dogs eat first.',
    location: 'Theo’s place',
    days: 3,
    hour: 19,
    hours: 3,
    colorTheme: 'candlelight',
    fontPairing: 'monoton',
    answers: { alex: 'going', jonah: 'maybe' },
  },
  {
    host: 'alex',
    past: true,
    title: 'Beach day at Golden Gardens',
    description: 'Sandy dogs, sunset, and a lot of fetch.',
    location: 'Golden Gardens Park',
    days: -12,
    hour: 16,
    hours: 4,
    colorTheme: 'pool',
    fontPairing: 'bungee-shade',
    answers: { lena: 'going', maya: 'going', theo: 'maybe' },
    messages: [['lena', 'Best day. Same time next year?']],
  },
  {
    host: 'lena',
    past: true,
    title: 'Wine and whiskers',
    description: 'A grown-up evening. Well-behaved dogs welcome.',
    location: 'Lena’s apartment',
    days: -5,
    hour: 19,
    hours: 3,
    colorTheme: 'wine',
    fontPairing: 'fascinate-inline',
    answers: { alex: 'going', priya: 'going' },
  },
];
const postsPerMember = { alex: 4, maya: 4, jonah: 3, priya: 4, theo: 2 };
const defaultPosts = 2;
const pick = (list, i) => list[i % list.length];

// Photos come from the public dog.ceo API and are cached outside source control.
const photoCount =
  members.length +
  seedEvents.length +
  members.reduce((n, m) => n + (postsPerMember[m.handle] ?? defaultPosts), 0);
await mkdir(photoDir, { recursive: true });
let photos = (await readdir(photoDir)).filter((f) => f.endsWith('.jpg'));
while (photos.length < photoCount) {
  console.log(`Downloading photos (${photos.length}/${photoCount})…`);
  const listing = await fetch(
    'https://dog.ceo/api/breeds/image/random/50',
  ).then((r) => r.json());
  for (const url of listing.message) {
    if (photos.length >= photoCount) break;
    const name = url.split('/').slice(-2).join('-');
    if (!name.endsWith('.jpg') || photos.includes(name)) continue;
    const response = await fetch(url);
    if (!response.ok) continue;
    const bytes = new Uint8Array(await response.arrayBuffer());
    // Skip tiny thumbnails and anything over the 8 MiB upload limit.
    if (bytes.length < 40_000 || bytes.length > 8 * 1024 * 1024) continue;
    await writeFile(`${photoDir}/${name}`, bytes);
    photos.push(name);
  }
}
photos = photos.sort().slice(0, photoCount);
let nextPhoto = 0;
const photo = () => readFile(`${photoDir}/${photos[nextPhoto++]}`);

const wrangler = (...args) =>
  execFileSync('node_modules/.bin/wrangler', args, { stdio: 'inherit' });
console.log('Resetting local D1/R2…');
await rm('.wrangler/state', { recursive: true, force: true });
wrangler('d1', 'migrations', 'apply', 'slowmass', '--local');

// Seed sessions are signed the same way as the integration-test fixtures and
// deleted once seeding finishes.
const now = Date.now();
const iso = new Date(now).toISOString();
const expires = new Date(now + 3600000).toISOString();
// A UTC instant for an hour of the local day in the events' time zone.
function zonedTime(days, hour) {
  const date = new Date(now + days * 86400000);
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: zone })
    .format(date)
    .split('-')
    .map(Number);
  const guess = Date.UTC(y, m - 1, d, hour);
  const offset = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(new Date(guess))
    .find((part) => part.type === 'timeZoneName')
    .value.match(/([+-])(\d\d):(\d\d)/);
  const minutes =
    (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === '-' ? -1 : 1);
  return guess - minutes * 60000;
}
const quote = (v) =>
  v === null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const sql = [];
const cookies = {};
for (const m of members) {
  const token = randomBytes(24).toString('hex');
  cookies[m.handle] =
    `better-auth.session_token=${encodeURIComponent(`${token}.${await makeSignature(token, vars.AUTH_SECRET)}`)}`;
  sql.push(
    `INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(${quote(m.id)},${quote(m.name)},${quote(m.email)},1,${quote(iso)},${quote(iso)});`,
  );
  if (m.inviter)
    sql.push(
      `INSERT INTO invitation(id,inviter_id,recipient_email,created_at,expires_at) VALUES(${quote(`inv-${m.id}`)},${quote(m.inviter)},${quote(m.email.toLowerCase())},${now},${now + 86400000});`,
    );
  sql.push(
    `INSERT INTO membership(user_id,invited_by,invitation_id,joined_at) VALUES(${quote(m.id)},${quote(m.inviter ?? null)},${quote(m.inviter ? `inv-${m.id}` : null)},${now});`,
    `INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES(${quote(`seed-session-${m.handle}`)},${quote(m.id)},${quote(token)},${quote(expires)},${quote(iso)},${quote(iso)});`,
  );
}
await writeFile(sqlFile, sql.join('\n'));
wrangler('d1', 'execute', 'slowmass', '--local', '--file', sqlFile);

// Seeding drives the application's own API through a local worker.
const api = async (handle, method, path, body, headers = {}) => {
  const response = await fetch(origin + path, {
    method,
    headers: {
      Origin: origin,
      Cookie: cookies[handle],
      ...(body instanceof Uint8Array
        ? { 'Content-Type': 'image/jpeg' }
        : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body:
      body === undefined || body instanceof Uint8Array
        ? body
        : JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`${method} ${path} as ${handle}: ${response.status}`);
  return response.json();
};

async function withWorker(seed) {
  const worker = await unstable_startWorker({
    config: 'wrangler.jsonc',
    dev: {
      server: { hostname: 'localhost', port: 8787 },
      inspector: false,
      logLevel: 'warn',
    },
  });
  try {
    await worker.ready;
    await seed();
  } finally {
    await worker.dispose();
  }
}
await withWorker(async () => {
  console.log('Creating profiles…');
  for (const m of members) {
    await api(m.handle, 'PUT', '/api/people/self', {
      handle: m.handle,
      displayName: m.name,
      bio: m.bio,
    });
    await api(m.handle, 'PUT', '/api/avatar', await photo(), {
      'Idempotency-Key': randomUUID(),
    });
  }
  // Mirror the invitation-tree follows so comments only come from viewers.
  const handleOf = Object.fromEntries(members.map((m) => [m.id, m.handle]));
  const accepted = new Set();
  for (const m of members.filter((m) => m.inviter)) {
    accepted.add(`${m.handle}>${handleOf[m.inviter]}`);
    accepted.add(`${handleOf[m.inviter]}>${m.handle}`);
  }
  for (const [follower, target, accept] of follows) {
    await api(follower, 'POST', `/api/people/${target}/request`);
    if (!accept) continue;
    await api(target, 'POST', `/api/people/${follower}/accept`);
    accepted.add(`${follower}>${target}`);
  }

  console.log('Posting photos…');
  let i = 0;
  for (const m of members)
    for (let n = 0; n < (postsPerMember[m.handle] ?? defaultPosts); n++, i++) {
      const id = randomUUID();
      await api(m.handle, 'POST', '/api/posts', {
        id,
        caption: pick(captions, i),
        altText: '',
      });
      await api(m.handle, 'PUT', `/api/posts/${id}/photo`, await photo());
      const viewers = members
        .map((v) => v.handle)
        .filter((h) => accepted.has(`${h}>${m.handle}`));
      for (const [k, viewer] of viewers.entries()) {
        if ((i + k) % 3 !== 2)
          await api(viewer, 'PUT', `/api/interactions/${id}/like`);
        if (k === 0 || (i + k) % 2 === 0)
          await api(viewer, 'POST', `/api/interactions/${id}/comments`, {
            id: randomUUID(),
            body: pick(comments, i * 3 + k),
          });
      }
      if (viewers.length && i % 3 === 0)
        await api(m.handle, 'POST', `/api/interactions/${id}/comments`, {
          id: randomUUID(),
          body: 'Ha, thank you!',
        });
    }
});
// Each member may start five photo uploads a day, which profiles and posts
// have used up; age those attempts past the daily window before events add
// covers.
wrangler(
  'd1',
  'execute',
  'slowmass',
  '--local',
  '--command',
  'UPDATE photo_attempt SET created_at=created_at-86400000',
);
const pastEvents = [];
await withWorker(async () => {
  console.log('Creating events…');
  // Answers close once an event is over, so past events are created in the
  // future, answered, and moved back after the worker stops.
  for (const [i, e] of seedEvents.entries()) {
    const id = randomUUID();
    const answerDays = e.past ? 1 + i : e.days;
    const startsAt = zonedTime(answerDays, e.hour);
    await api(e.host, 'POST', '/api/events', {
      id,
      title: e.title,
      description: e.description,
      location: e.location,
      startsAt,
      endsAt: startsAt + e.hours * 3600000,
      timeZone: zone,
      appearance: { colorTheme: e.colorTheme, fontPairing: e.fontPairing },
    });
    await api(e.host, 'PUT', `/api/events/${id}/photo`, await photo(), {
      'Idempotency-Key': randomUUID(),
    });
    if (e.past) {
      const start = zonedTime(e.days, e.hour);
      pastEvents.push([id, start, start + e.hours * 3600000]);
    }
    const { event } = await api(e.host, 'GET', `/api/events/${id}`);
    const token = new URL(event.url).pathname.split('/').pop();
    for (const handle of [...Object.keys(e.answers), ...(e.invited ?? [])])
      if (handle !== e.host)
        await api(handle, 'POST', '/api/events/open', { token });
    await api(e.host, 'POST', `/api/events/${id}/response`, {
      status: 'going',
    });
    for (const [handle, status] of Object.entries(e.answers))
      if (handle !== e.host)
        await api(handle, 'POST', `/api/events/${id}/response`, { status });
    for (const [handle, body] of e.messages ?? [])
      await api(handle, 'POST', `/api/events/${id}/messages`, {
        id: randomUUID(),
        body,
      });
    const hostId = (handle) => members.find((m) => m.handle === handle).id;
    if (e.cohost) {
      await api(e.host, 'POST', `/api/events/${id}/hosts`, {
        userId: hostId(e.cohost),
      });
      await api(e.cohost, 'POST', `/api/events/${id}/hosting`);
    }
    if (e.askToHost)
      await api(e.host, 'POST', `/api/events/${id}/hosts`, {
        userId: hostId(e.askToHost),
      });
    if (e.cancel)
      await api(e.host, 'POST', `/api/events/${id}/cancel`, {
        messageId: randomUUID(),
      });
  }
});
wrangler(
  'd1',
  'execute',
  'slowmass',
  '--local',
  '--command',
  "DELETE FROM session WHERE id LIKE 'seed-session-%'",
);
if (pastEvents.length)
  wrangler(
    'd1',
    'execute',
    'slowmass',
    '--local',
    '--command',
    pastEvents
      .map(
        ([id, start, end]) =>
          `UPDATE event SET starts_at=${start},ends_at=${end} WHERE id=${quote(id)};`,
      )
      .join(''),
  );
await rm(sqlFile);
console.log(
  `Seeded ${members.length} members. Run \`npm run dev\` and sign in as ${members[0].email}.`,
);
