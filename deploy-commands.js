require('dotenv').config();

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a YouTube track or playlist')
    .addStringOption((option) =>
      option.setName('query').setDescription('Song name or source link').setRequired(true)
    )
    .toJSON(),
  new SlashCommandBuilder().setName('join').setDescription('Join your voice channel').toJSON(),
  new SlashCommandBuilder().setName('pause').setDescription('Pause playback').toJSON(),
  new SlashCommandBuilder().setName('resume').setDescription('Resume playback').toJSON(),
  new SlashCommandBuilder().setName('skip').setDescription('Skip the current track').toJSON(),
  new SlashCommandBuilder().setName('queue').setDescription('Show queued tracks').toJSON(),
  new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear the queue').toJSON(),
  new SlashCommandBuilder().setName('leave').setDescription('Disconnect from voice').toJSON(),
  new SlashCommandBuilder().setName('help').setDescription('Show available bot commands').toJSON()
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    if (!process.env.DISCORD_TOKEN) {
      throw new Error('Missing DISCORD_TOKEN in .env');
    }

    if (!process.env.CLIENT_ID) {
      throw new Error('Missing CLIENT_ID in .env');
    }

    const guildId = process.env.GUILD_ID;
    if (!guildId) {
      throw new Error('Missing GUILD_ID in .env. Set it to the server you want to test in.');
    }

    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId), {
      body: commands
    });

    console.log('Music bot slash commands registered successfully.');
  } catch (error) {
    console.error('Failed to register slash commands:', error.message);
    process.exit(1);
  }
})();
