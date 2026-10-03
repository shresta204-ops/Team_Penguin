// Mock API helpers. In a real app these would call fetch('/api/...').

const MOCK_USER = {
  id: 42,
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  role: 'Maintainer',
  avatarUrl: 'https://avatars.githubusercontent.com/u/9919?v=4',
  joined: '2021-03-14',
};

const MOCK_STATS = [
  { label: 'Open issues', value: 12 },
  { label: 'Pull requests', value: 5 },
  { label: 'Commits this week', value: 38 },
  { label: 'Stars', value: 1204 },
];

function delay(value, ms = 300) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export function getCurrentUser() {
  return delay({ ...MOCK_USER });
}

export function getStats() {
  return delay(MOCK_STATS.map((s) => ({ ...s })));
}
