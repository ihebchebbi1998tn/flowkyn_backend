import { pool } from './src/config/database';

async function seedRoles() {
  const client = await pool.connect();
  try {
    console.log('Seeding default roles...');
    await client.query(`
      INSERT INTO roles (id, name, description) VALUES
        (uuid_generate_v4(), 'owner', 'Organization owner with full access'),
        (uuid_generate_v4(), 'admin', 'Administrator with management access'),
        (uuid_generate_v4(), 'moderator', 'Can moderate events and content'),
        (uuid_generate_v4(), 'member', 'Standard organization member')
      ON CONFLICT (name) DO NOTHING;
    `);
    
    console.log('Seeding default game types...');
    await client.query(`
      INSERT INTO game_types (id, key, name, category, is_sync, min_players, max_players, description) VALUES
        (uuid_generate_v4(), 'two-truths', 'Two Truths and a Lie', 'icebreaker', true, 3, 30, 'Classic icebreaker where each person shares two truths and one lie.'),
        (uuid_generate_v4(), 'coffee-roulette', 'Coffee Roulette', 'connection', true, 2, 2, 'Random 1:1 pairings for virtual coffee chats.'),
        (uuid_generate_v4(), 'wins-of-week', 'Wins of the Week', 'wellness', false, 2, 999, 'Weekly thread where everyone shares one win from their week.'),
        (uuid_generate_v4(), 'trivia', 'Icebreaker Trivia', 'icebreaker', true, 2, 50, 'Fun trivia questions to get the team laughing and learning.'),
        (uuid_generate_v4(), 'scavenger-hunt', 'Team Scavenger Hunt', 'competition', true, 4, 50, 'Teams race to find and share items or complete challenges.'),
        (uuid_generate_v4(), 'gratitude', 'Gratitude Circle', 'wellness', false, 2, 999, 'Share one thing you appreciate about a colleague this week.')
      ON CONFLICT (key) DO NOTHING;
    `);

    console.log('✅ Seed completed successfully!');
  } catch (err) {
    console.error('❌ Seeding failed:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

seedRoles();
