// ========== MOCK DATA ==========

export const forums = [
  { id: '1', name: 'Demo Forum', members: 342, seed: 'demo-forum', unread: 3, threads: 47 },
  { id: '2', name: 'Indie Game Dev', members: 1205, seed: 'indie-gamedev', unread: 0, threads: 183 },
  { id: '3', name: 'Vinyl Collectors', members: 89, seed: 'vinyl-club', unread: 7, threads: 31 },
  { id: '4', name: 'Local Coffee Shops', members: 56, seed: 'coffee-local', unread: 0, threads: 12 },
];

export const dms = [
  { id: 'dm1', name: 'testuser_debug', seed: 'testuser_debug', preview: 'Hey, did you see the new...', unread: true, online: true },
  { id: 'dm2', name: 'alice_dev', seed: 'alice-dev', preview: 'The deploy went fine!', unread: false, online: false },
  { id: 'dm3', name: 'bob_music', seed: 'bob-music', preview: 'Check out this track', unread: false, online: true },
];

export const threads = {
  '1': [
    { id: 't1', title: 'Welcome to the Demo Forum!', author: 'admin', seed: 'admin', snippet: 'This is the official demo forum for testing Forumline features...', replies: 24, time: '2h ago', pinned: true, label: 'announcement' },
    { id: 't2', title: 'How do voice rooms work?', author: 'testuser_debug', seed: 'testuser_debug', snippet: 'I just tried joining a voice room and the quality is amazing...', replies: 12, time: '5h ago', label: 'question' },
    { id: 't3', title: 'Feature request: Dark mode', author: 'alice_dev', seed: 'alice-dev', snippet: 'Would love to see a dark mode option for late night browsing...', replies: 31, time: '1d ago', label: 'discussion' },
    { id: 't4', title: 'Best practices for forum moderation', author: 'moderator_jane', seed: 'jane-mod', snippet: 'After running several forums, here are my tips for healthy communities...', replies: 8, time: '2d ago' },
    { id: 't5', title: 'Introducing myself!', author: 'newuser42', seed: 'newuser42', snippet: 'Hi everyone! Just joined Forumline and excited to be here...', replies: 15, time: '3d ago' },
    { id: 't12', title: 'Voice room latency — anyone else noticing?', author: 'testcaller', seed: 'testcaller', snippet: 'Been in a few voice rooms today and noticed some slight latency on my end...', replies: 6, time: '4d ago', label: 'question' },
  ],
  '2': [
    { id: 't6', title: 'My first Godot game - feedback?', author: 'pixel_pete', seed: 'pixel-pete', snippet: 'Been working on a platformer for 3 months, looking for honest feedback...', replies: 42, time: '1h ago', label: 'question', hasImage: true },
    { id: 't7', title: 'Unity vs Godot in 2026', author: 'engine_wars', seed: 'engine-wars', snippet: 'Let\'s have a civil discussion about the current state of game engines...', replies: 89, time: '3h ago', label: 'discussion', pinned: true },
    { id: 't8', title: 'Free pixel art for your games', author: 'art_sarah', seed: 'art-sarah', snippet: 'I made a bunch of character sprites and tilesets, free to use CC-BY...', replies: 56, time: '12h ago', hasImage: true },
    { id: 't13', title: 'Godot 4.4 migration tips?', author: 'testcaller', seed: 'testcaller', snippet: 'Planning to migrate my project from 4.3 to 4.4. Anyone done this yet?', replies: 11, time: '2d ago', label: 'question' },
  ],
  '3': [
    { id: 't9', title: 'Found a mint condition Blue Note pressing!', author: 'vinyl_joe', seed: 'vinyl-joe', snippet: 'Can\'t believe what I found at the thrift store today...', replies: 18, time: '4h ago', hasImage: true },
    { id: 't10', title: 'Best budget turntable 2026?', author: 'spinner', seed: 'spinner', snippet: 'Looking to upgrade from my AT-LP60. Budget around $300...', replies: 22, time: '1d ago', label: 'question', resolved: true },
  ],
  '4': [
    { id: 't11', title: 'New spot on Main St is incredible', author: 'bean_queen', seed: 'bean-queen', snippet: 'They do single origin pour overs and the space is gorgeous...', replies: 7, time: '6h ago', hasImage: true },
  ],
};

export const posts = {
  't1': [
    { author: 'admin', seed: 'admin', time: '2 days ago', content: 'Welcome to the Demo Forum! This is the official testing ground for Forumline. Feel free to explore, post, and try out all the features. Voice rooms are available in the top right.', reactions: { '&#x1F44D;': { count: 12, active: true }, '&#x2764;': { count: 5, active: false }, '&#x1F389;': { count: 8, active: true } } },
    { author: 'testcaller', seed: 'testcaller', time: '2 days ago', content: 'Great to be here! The interface feels really polished. Love the skeuomorphic design.', reactions: { '&#x1F44D;': { count: 3, active: false } } },
    { author: 'testuser_debug', seed: 'testuser_debug', time: '1 day ago', content: 'The real-time updates are snappy. Is this using SSE under the hood?', reactions: {} },
    { author: 'admin', seed: 'admin', time: '1 day ago', content: 'Yes! We use **Postgres LISTEN/NOTIFY** for real-time. No external message queue needed. Keeps the stack simple.\n\n```sql\nLISTEN new_post;\nNOTIFY new_post, \'{"thread_id": "abc123"}\';\n```\n\nCheck the [PostgreSQL docs](https://postgresql.org) for more.', reactions: { '&#x1F4A1;': { count: 7, active: false }, '&#x1F44D;': { count: 4, active: true } } },
    { author: 'alice_dev', seed: 'alice-dev', time: '5 hours ago', content: 'Just tested the voice rooms - crystal clear audio. LiveKit is doing the heavy lifting there I assume?', reactions: {} },
  ],
  't2': [
    { author: 'testuser_debug', seed: 'testuser_debug', time: '5 hours ago', content: 'I just tried joining a voice room and the quality is amazing. How does the voice room system work technically?', reactions: {} },
    { author: 'admin', seed: 'admin', time: '4 hours ago', content: 'We use **LiveKit** for voice/video. When you join a room, the server generates a short-lived JWT token that grants access.\n\nThe flow is:\n1. Client calls `/api/voice/token`\n2. Server creates a `livekit.AccessToken` with room permissions\n3. Client connects via `Room.connect(url, token)`\n\nThe WebRTC connection is *peer-to-peer* when possible, with LiveKit\'s SFU as fallback.', reactions: { '&#x1F4A1;': { count: 3, active: false }, '&#x1F44D;': { count: 6, active: true } } },
    { author: 'testcaller', seed: 'testcaller', time: '3 hours ago', content: 'The native integration on iOS is really nice too. It uses CallKit so you get the native phone UI.', reactions: { '&#x1F4F1;': { count: 2, active: false } } },
  ],
  't7': [
    { author: 'engine_wars', seed: 'engine-wars', time: '3 hours ago', content: 'Let\'s settle this once and for all. Both engines have come a long way, but which one are you actually shipping games with in 2026?\n\nI\'ve been using Godot for the past year and the GDExtension ecosystem has really matured.', reactions: { '&#x1F525;': { count: 15, active: false }, '&#x1F44D;': { count: 8, active: true } } },
    { author: 'pixel_pete', seed: 'pixel-pete', time: '2 hours ago', content: 'Godot all the way. The 2D workflow is unmatched and the scene system just *clicks*. Unity still has the edge for 3D though.', reactions: { '&#x1F44D;': { count: 6, active: false } } },
    { author: 'art_sarah', seed: 'art-sarah', time: '1 hour ago', content: 'I actually switched from Unity to Godot mid-project last year. The transition was surprisingly smooth. The community is incredibly helpful.', reactions: { '&#x2764;': { count: 3, active: false } } },
  ],
  't6': [
    { author: 'pixel_pete', seed: 'pixel-pete', time: '1 hour ago', content: 'Been working on this platformer for 3 months now. It\'s my first Godot game and I\'d love some honest feedback on the gameplay feel and level design.\n\nControls: WASD + Space to jump, E to interact.', reactions: { '&#x1F44D;': { count: 4, active: false }, '&#x1F389;': { count: 2, active: false } } },
    { author: 'testcaller', seed: 'testcaller', time: '45 min ago', content: 'This looks amazing for a first game! The pixel art style is really cohesive. My only feedback would be to add some juice to the jump — maybe a squash and stretch animation.', reactions: { '&#x1F4A1;': { count: 1, active: false } } },
  ],
  't9': [
    { author: 'vinyl_joe', seed: 'vinyl-joe', time: '4 hours ago', content: 'Can\'t believe what I found at the thrift store today — a **mint condition Blue Note pressing** of Art Blakey\'s Moanin\'. The original deep groove Lexington Ave pressing. $3.\n\nI\'m still shaking.', reactions: { '&#x1F44F;': { count: 12, active: false }, '&#x2764;': { count: 8, active: true }, '&#x1F440;': { count: 5, active: false } } },
  ],
  't10': [
    { author: 'spinner', seed: 'spinner', time: '1 day ago', content: 'Looking to upgrade from my AT-LP60. Budget is around $300. What do you all recommend? I mostly listen to jazz and classic rock.', reactions: { '&#x1F44D;': { count: 2, active: false } } },
    { author: 'vinyl_joe', seed: 'vinyl-joe', time: '20 hours ago', content: 'For $300 you can\'t go wrong with the **Fluance RT85**. Great cartridge included and the build quality is solid. The AT-LP120 is also a classic choice.', reactions: { '&#x1F4A1;': { count: 4, active: false } } },
  ],
  't11': [
    { author: 'bean_queen', seed: 'bean-queen', time: '6 hours ago', content: 'Just discovered this new spot on Main St called **Ember & Pour**. They do single origin pour overs and the space is gorgeous — exposed brick, natural light, and a record player in the corner.\n\nThe Ethiopian Yirgacheffe was incredible. Definitely worth checking out.', reactions: { '&#x2615;': { count: 6, active: false }, '&#x2764;': { count: 3, active: true } } },
  ],
  't12': [
    { author: 'testcaller', seed: 'testcaller', time: '4 days ago', content: 'Been in a few voice rooms today and noticed some slight latency on my end. About 200-300ms delay. Is this normal or is something up with my connection?\n\nUsing Chrome on macOS, connection is 100mbps fiber.', reactions: { '&#x1F44D;': { count: 2, active: false } } },
    { author: 'admin', seed: 'admin', time: '4 days ago', content: 'That latency is higher than expected. We typically see 50-100ms. Could you check `chrome://webrtc-internals` while in a voice room and share the stats?', reactions: { '&#x1F4A1;': { count: 3, active: false } } },
  ],
  't13': [
    { author: 'testcaller', seed: 'testcaller', time: '2 days ago', content: 'Planning to migrate my project from Godot 4.3 to 4.4. The new **typed dictionaries** and **improved GDExtension** look great but I\'m worried about breaking changes.\n\nAnyone done this yet? How painful was it?', reactions: { '&#x1F44D;': { count: 4, active: false } } },
    { author: 'pixel_pete', seed: 'pixel-pete', time: '2 days ago', content: 'I migrated last week. Mostly painless — the editor handles most of the conversion automatically. Only had to manually fix a few signal connections.', reactions: { '&#x1F4A1;': { count: 2, active: false } } },
  ],
};

export const forumMembers = {
  '1': [
    { name: 'admin', seed: 'admin', role: 'Owner', online: true },
    { name: 'testcaller', seed: 'testcaller', role: 'Member', online: true },
    { name: 'testuser_debug', seed: 'testuser_debug', role: 'Moderator', online: true },
    { name: 'alice_dev', seed: 'alice-dev', role: 'Member', online: false },
    { name: 'moderator_jane', seed: 'jane-mod', role: 'Moderator', online: false },
    { name: 'newuser42', seed: 'newuser42', role: 'Member', online: false },
    { name: 'bob_music', seed: 'bob-music', role: 'Member', online: true },
    { name: 'pixel_pete', seed: 'pixel-pete', role: 'Member', online: false },
  ],
  '2': [
    { name: 'pixel_pete', seed: 'pixel-pete', role: 'Owner', online: true },
    { name: 'engine_wars', seed: 'engine-wars', role: 'Moderator', online: false },
    { name: 'art_sarah', seed: 'art-sarah', role: 'Member', online: true },
    { name: 'testcaller', seed: 'testcaller', role: 'Member', online: true },
  ],
  '3': [
    { name: 'vinyl_joe', seed: 'vinyl-joe', role: 'Owner', online: true },
    { name: 'spinner', seed: 'spinner', role: 'Member', online: false },
    { name: 'testcaller', seed: 'testcaller', role: 'Member', online: true },
  ],
  '4': [
    { name: 'bean_queen', seed: 'bean-queen', role: 'Owner', online: false },
    { name: 'testcaller', seed: 'testcaller', role: 'Member', online: true },
  ],
};

export const messages = {
  'dm1': [
    { from: 'testuser_debug', content: 'Hey, have you seen the new forum discover page?', time: '10:30 AM' },
    { from: 'me', content: 'Not yet! Is it live?', time: '10:32 AM' },
    { from: 'testuser_debug', content: 'Yeah, check it out. The category filters are really smooth.', time: '10:33 AM' },
    { from: 'me', content: 'Nice, looking at it now. The cards look great.', time: '10:35 AM' },
    { from: 'testuser_debug', content: 'Hey, did you see the new voice room indicators?', time: '2:15 PM' },
  ],
};

export const discoverForums = [
  { name: 'Retro Computing', desc: 'Celebrating vintage hardware, from Apple II to Amiga. Repair tips, collections, and nostalgia.', members: 2341, banner: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', seed: 'retro-computing' },
  { name: 'Plant Parents', desc: 'Share your indoor jungle. Watering tips, propagation, and plant identification help.', members: 5672, banner: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', seed: 'plant-parents' },
  { name: 'Analog Photography', desc: 'Film photography community. Darkroom techniques, camera reviews, and weekly photo challenges.', members: 1893, banner: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)', seed: 'analog-photo' },
  { name: 'Sourdough Bakers', desc: 'Everything about naturally leavened bread. Starter tips, recipes, and crumb shots.', members: 8234, banner: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)', seed: 'sourdough' },
  { name: 'City Cycling', desc: 'Urban cycling advocacy, route sharing, and bike maintenance for city riders.', members: 3102, banner: 'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)', seed: 'city-cycling' },
  { name: 'Board Game Nights', desc: 'Find local game groups, discuss strategy, and review new releases.', members: 4521, banner: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)', seed: 'board-games' },
  { name: 'DIY Electronics', desc: 'Arduino, Raspberry Pi, and beyond. Project showcases and troubleshooting.', members: 6120, banner: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', seed: 'diy-electronics' },
  { name: 'Creative Writing', desc: 'Share your fiction, poetry, and essays. Constructive feedback and writing prompts.', members: 2987, banner: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)', seed: 'creative-writing' },
];

export const activities = [
  { user: 'testcaller', seed: 'testcaller', text: '<strong>testcaller</strong> replied to "My first Godot game - feedback?" in <span class="activity-forum">Indie Game Dev</span>', time: '45 min ago' },
  { user: 'testuser_debug', seed: 'testuser_debug', text: '<strong>testuser_debug</strong> replied to "How do voice rooms work?" in <span class="activity-forum">Demo Forum</span>', time: '2 hours ago' },
  { user: 'testcaller', seed: 'testcaller', text: '<strong>testcaller</strong> replied to "How do voice rooms work?" in <span class="activity-forum">Demo Forum</span>', time: '3 hours ago' },
  { user: 'art_sarah', seed: 'art-sarah', text: '<strong>art_sarah</strong> posted "Free pixel art for your games" in <span class="activity-forum">Indie Game Dev</span>', time: '5 hours ago' },
  { user: 'vinyl_joe', seed: 'vinyl-joe', text: '<strong>vinyl_joe</strong> started "Found a mint condition Blue Note pressing!" in <span class="activity-forum">Vinyl Collectors</span>', time: '8 hours ago' },
  { user: 'testcaller', seed: 'testcaller', text: '<strong>testcaller</strong> replied to "Welcome to the Demo Forum!" in <span class="activity-forum">Demo Forum</span>', time: '2 days ago' },
  { user: 'admin', seed: 'admin', text: '<strong>admin</strong> replied to "Welcome to the Demo Forum!" in <span class="activity-forum">Demo Forum</span>', time: '1 day ago' },
  { user: 'bean_queen', seed: 'bean-queen', text: '<strong>bean_queen</strong> posted "New spot on Main St is incredible" in <span class="activity-forum">Local Coffee Shops</span>', time: '1 day ago' },
];

export const notifications = [
  { id: 'n1', user: 'testuser_debug', seed: 'testuser_debug', text: '<strong>testuser_debug</strong> replied to your post in "How do voice rooms work?"', time: '2 hours ago', unread: true },
  { id: 'n2', user: 'alice_dev', seed: 'alice-dev', text: '<strong>alice_dev</strong> mentioned you in "Welcome to the Demo Forum!"', time: '5 hours ago', unread: true },
  { id: 'n3', user: 'vinyl_joe', seed: 'vinyl-joe', text: '<strong>vinyl_joe</strong> invited you to voice in Vinyl Collectors', time: '1 day ago', unread: true },
  { id: 'n4', user: 'pixel_pete', seed: 'pixel-pete', text: '<strong>pixel_pete</strong> liked your reply in "My first Godot game"', time: '2 days ago', unread: false },
  { id: 'n5', user: 'admin', seed: 'admin', text: '<strong>admin</strong> pinned "Welcome to the Demo Forum!"', time: '3 days ago', unread: false },
];

export const profiles = {
  'testcaller': { name: 'testcaller', seed: 'testcaller', bio: 'Exploring the forumline network. Voice room enthusiast.', forums: 4, threads: 12, replies: 156, joined: 'Jan 2026' },
  'testuser_debug': { name: 'testuser_debug', seed: 'testuser_debug', bio: 'Full-stack developer. Always debugging something.', forums: 6, threads: 28, replies: 342, joined: 'Dec 2025' },
  'alice_dev': { name: 'alice_dev', seed: 'alice-dev', bio: 'Software engineer and voice room regular.', forums: 3, threads: 8, replies: 94, joined: 'Feb 2026' },
  'admin': { name: 'admin', seed: 'admin', bio: 'Forumline platform administrator.', forums: 8, threads: 45, replies: 512, joined: 'Nov 2025' },
};

export const pollData = {
  't7': {
    question: 'Which game engine do you prefer in 2026?',
    options: [
      { text: 'Godot', votes: 156 },
      { text: 'Unity', votes: 89 },
      { text: 'Unreal Engine', votes: 67 },
      { text: 'Custom / Other', votes: 23 },
    ],
    totalVotes: 335,
    userVoted: null,
  },
  't10': {
    question: 'Best budget turntable brand?',
    options: [
      { text: 'Audio-Technica', votes: 42 },
      { text: 'Fluance', votes: 28 },
      { text: 'U-Turn', votes: 19 },
      { text: 'Pro-Ject', votes: 35 },
    ],
    totalVotes: 124,
    userVoted: null,
  },
};

export const postImages = {
  't9': [0],
  't11': [0],
  't6': [0],
  't8': [0, 1],
};

export const threadViewers = {
  't1': [
    { name: 'testuser_debug', seed: 'testuser_debug' },
    { name: 'alice_dev', seed: 'alice-dev' },
  ],
  't7': [
    { name: 'pixel_pete', seed: 'pixel-pete' },
    { name: 'engine_wars', seed: 'engine-wars' },
    { name: 'art_sarah', seed: 'art-sarah' },
  ],
  't2': [
    { name: 'admin', seed: 'admin' },
  ],
};

export const badgeDefinitions = [
  { id: 'early-adopter', icon: '&#x2B50;', name: 'Early Adopter', desc: 'Joined during beta', class: 'badge-early-adopter' },
  { id: 'voice-enthusiast', icon: '&#x1F3A4;', name: 'Voice Enthusiast', desc: '10+ hours in voice rooms', class: 'badge-voice-enthusiast' },
  { id: 'thread-starter', icon: '&#x1F4DD;', name: 'Thread Starter', desc: 'Created 10+ threads', class: 'badge-thread-starter' },
  { id: 'helper', icon: '&#x1F91D;', name: 'Helpful', desc: '50+ replies marked useful', class: 'badge-helper' },
  { id: 'og', icon: '&#x1F451;', name: 'OG Member', desc: 'Member for 1+ year', class: 'badge-og' },
  { id: 'night-owl', icon: '&#x1F319;', name: 'Night Owl', desc: 'Active past midnight 20+ times', class: 'badge-night-owl' },
];

export const userBadges = {
  'testcaller': ['early-adopter', 'voice-enthusiast', 'thread-starter'],
  'testuser_debug': ['early-adopter', 'helper', 'og', 'night-owl'],
  'alice_dev': ['early-adopter', 'voice-enthusiast'],
  'admin': ['early-adopter', 'og', 'thread-starter', 'helper', 'voice-enthusiast', 'night-owl'],
};

export const linkPreviews = {
  't2': {
    postIndex: 1,
    domain: 'livekit.io',
    title: 'LiveKit: Open Source WebRTC',
    desc: 'Build real-time audio and video applications with an open source WebRTC stack. Scale to millions of concurrent users.',
    color: '#6366f1',
  },
  't1': {
    postIndex: 3,
    domain: 'postgresql.org',
    title: 'PostgreSQL LISTEN/NOTIFY',
    desc: 'Asynchronous notification mechanism for Postgres. Allows efficient real-time communication between client and server.',
    color: '#336791',
  }
};

export const onboardingSteps = [
  {
    emoji: '&#x1F30D;',
    bg: 'linear-gradient(135deg, #667eea, #764ba2)',
    title: 'Welcome to Forumline',
    text: 'A network of communities built for meaningful conversation. Join forums, voice chat, and connect with people who share your interests.'
  },
  {
    emoji: '&#x1F4AC;',
    bg: 'linear-gradient(135deg, #f093fb, #f5576c)',
    title: 'Forums for Everything',
    text: 'Browse thousands of communities or create your own. Each forum is a home for a topic you care about — from vinyl collecting to game development.'
  },
  {
    emoji: '&#x1F3A4;',
    bg: 'linear-gradient(135deg, #4facfe, #00f2fe)',
    title: 'Voice Rooms',
    text: 'Jump into voice rooms to talk with your community in real time. No scheduling, no links — just click and connect.'
  },
  {
    emoji: '&#x1F680;',
    bg: 'linear-gradient(135deg, #f6d365, #fda085)',
    title: 'You\'re Ready!',
    text: 'Start by exploring the Discover page or jump into a forum from the sidebar. The community is waiting for you.',
    final: true
  }
];

// Command palette actions — action callbacks are null placeholders, wire up in main.js
export const commands = [
  { icon: '&#x2795;', name: 'Create Forum', action: null },
  { icon: '&#x1F4DD;', name: 'New Thread', action: null, shortcut: '' },
  { icon: '&#x2699;', name: 'Settings', action: null, shortcut: '' },
  { icon: '&#x1F464;', name: 'My Profile', action: null },
  { icon: '&#x1F30D;', name: 'Discover Forums', action: null },
  { icon: '&#x1F3A4;', name: 'Join Voice Room', action: null },
  { icon: '&#x1F319;', name: 'Toggle Dark Mode', action: null, shortcut: '' },
  { icon: '&#x1F3E0;', name: 'Go Home', action: null, shortcut: 'Esc' },
];

export const notifTargets = {
  'n1': { type: 'thread', id: 't2' },
  'n2': { type: 'thread', id: 't1' },
  'n3': { type: 'forum', id: '3' },
  'n4': { type: 'thread', id: 't6' },
  'n5': { type: 'thread', id: 't1' },
};
