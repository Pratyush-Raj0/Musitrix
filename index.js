require('dotenv').config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  GatewayIntentBits,
  Events,
  EmbedBuilder
} = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior
} = require('@discordjs/voice');
const youtubeDl = require('youtube-dl-exec');
const YTMusic = require('ytmusic-api');
const sharp = require('sharp');
const { getChatReply } = require('./chatbot');
const { handleModerationCommand } = require('./moderation');
const { filterAntiMessage, handleAntiMessageCommand } = require('./antimessages');
const { logModerationAction, MODERATION_LOG_CHANNEL_ID } = require('./moderation-logs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const queue = new Map();
const PREFIX = '-';
const MAX_QUEUE_SIZE = 500;
const PLAYBACK_GUILD_ID = '1468510731187257387';
const PLAYBACK_CHANNEL_ID = '1545374063139233905';
const BOT_INVITE_URL = 'https://discord.com/oauth2/authorize?client_id=1555583442090070049&permissions=317209141366016&integration_type=0&scope=bot';
const OWNER_SERVER_URL = 'https://discord.gg/f4gdNWwxWV';
const DEFAULT_EMBED_COLOR = 0x5865f2;
const SUCCESS_EMBED_COLOR = 0x57f287;
const WARNING_EMBED_COLOR = 0xed4245;
const VOLUME_STEP = 10;
const coverColorCache = new Map();
let youtubeMusicClient;

function makeEmbed(title, description, color = DEFAULT_EMBED_COLOR) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color);
}

function makeTrackEmbed(song, color) {
  const embed = new EmbedBuilder().setTitle(song.title).setColor(color);
  if (song.artist) embed.setDescription(song.artist);
  if (song.thumbnail) embed.setThumbnail(song.thumbnail);
  return embed;
}

function makePlaybackLogEmbed(song, color, event) {
  const embed = makeEmbed(
    event === 'queued' ? 'PLAYBACK LOG · QUEUED' : 'PLAYBACK LOG · NOW PLAYING',
    song.artist ? `**${song.title}**\n${song.artist}` : `**${song.title}**`,
    color
  ).setTimestamp();
  if (song.thumbnail) embed.setThumbnail(song.thumbnail);
  return embed;
}

function volumeControls() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music-volume-down')
      .setLabel('🔉 Volume −')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music-volume-mute')
      .setLabel('🔇 Mute')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music-volume-up')
      .setLabel('🔊 Volume +')
      .setStyle(ButtonStyle.Secondary)
  );
}

function cleanTitle(value) {
  return String(value || 'Untitled track').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function cleanSongTitle(title, artist) {
  let songTitle = cleanTitle(title);
  songTitle = songTitle.replace(/#[\p{L}\p{N}_]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const featuring = songTitle.match(/\s+(?:feat(?:uring)?\.?|ft\.?)\s+(.+?)(?:[\])}]*)?$/i);
  if (featuring) songTitle = songTitle.slice(0, featuring.index);
  if (artist) {
    const artistPrefix = new RegExp(`^${artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[-–—:]\\s*`, 'i');
    songTitle = songTitle.replace(artistPrefix, '');
  }
  return songTitle
    .replace(/\s*[\[(](?:official\s+)?(?:music\s+video|audio|video|lyrics?|visuali[sz]er|hd|4k)[^\])]*[\])]/gi, '')
    .replace(/\s*(?:[-|]\s*)?(?:official\s+(?:music\s+)?video|official\s+audio|official\s+lyrics?|music\s+video|lyrics?\s+video)\s*$/i, '')
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function getTrackDetails(title, artist) {
  const titleArtist = String(title || '').match(/^(.{1,80}?)\s+[-–—:]\s+(.+)$/);
  const featuring = String(title || '').match(/\s+(?:feat(?:uring)?\.?|ft\.?)\s+(.+?)(?:[\])}]*)?$/i);
  const baseArtist = titleArtist
    ? titleArtist[1].trim()
    : artist;
  const artistName = [
    baseArtist,
    featuring?.[1]?.replace(/[\])}]+$/, '').trim()
  ].filter(Boolean).join(', ');
  return {
    title: cleanSongTitle(title, baseArtist),
    artist: cleanTitle(artistName)
  };
}

function getThumbnail(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeTrackName(value) {
  return String(value || '')
    .toLocaleLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(?:feat(?:uring)?|ft)\.?\b.*$/i, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

async function addYouTubeMusicArtwork(song) {
  if (song.artworkSearched) return;
  song.artworkSearched = true;

  try {
    if (!youtubeMusicClient) {
      youtubeMusicClient = new YTMusic();
      await youtubeMusicClient.initialize();
    }

    const query = `${song.title} ${song.artist || ''}`.trim();
    const results = await youtubeMusicClient.search(query);
    const musicSongs = results.filter((result) => result.type === 'SONG' && result.videoId && result.thumbnails?.length);
    const targetTitle = normalizeTrackName(song.title);
    const targetArtist = normalizeTrackName(song.artist);
    const exactVideoId = song.url ? new URL(song.url).searchParams.get('v') : null;
    const rankedSongs = musicSongs
      .map((result) => {
        const resultTitle = normalizeTrackName(result.name || result.title);
        const resultArtist = normalizeTrackName(result.artist?.name || result.artist || '');
        const titleMatches = resultTitle === targetTitle
          || (targetTitle.length >= 5 && resultTitle.startsWith(`${targetTitle} `));
        const artistMatches = !targetArtist || resultArtist === targetArtist
          || resultArtist.includes(targetArtist) || targetArtist.includes(resultArtist);
        return {
          result,
          score: (result.videoId === exactVideoId ? 100 : 0)
            + (titleMatches ? 10 : 0)
            + (artistMatches ? 5 : 0)
        };
      })
      .filter(({ score }) => score >= 10)
      .sort((left, right) => right.score - left.score);
    const match = rankedSongs[0]?.result;
    const artwork = match?.thumbnails?.at(-1)?.url;
    if (!artwork) return;

    const highResolutionArtwork = artwork.replace(/=w\d+-h\d+/, '=w544-h544');
    song.thumbnail = getThumbnail(highResolutionArtwork) || song.thumbnail;
  } catch (error) {
    console.warn(`Could not get YouTube Music cover for "${song.title}":`, error.message);
  }
}

async function getCoverColor(thumbnail) {
  if (!thumbnail) return DEFAULT_EMBED_COLOR;
  if (coverColorCache.has(thumbnail)) return coverColorCache.get(thumbnail);

  const colorPromise = (async () => {
    try {
      const response = await fetch(thumbnail, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`thumbnail request returned HTTP ${response.status}`);
      const declaredLength = Number(response.headers.get('content-length'));
      if (declaredLength > 5 * 1024 * 1024) throw new Error('thumbnail exceeds the 5 MB limit');
      const image = Buffer.from(await response.arrayBuffer());
      if (!image.length || image.length > 5 * 1024 * 1024) throw new Error('thumbnail is empty or exceeds the 5 MB limit');
      const [red, green, blue] = await sharp(image)
        .resize(1, 1, { fit: 'cover' })
        .removeAlpha()
        .raw()
        .toBuffer();
      return (red << 16) | (green << 8) | blue;
    } catch (error) {
      console.warn('Could not sample song cover color:', error.message);
      return DEFAULT_EMBED_COLOR;
    }
  })();

  coverColorCache.set(thumbnail, colorPromise);
  if (coverColorCache.size > 128) coverColorCache.delete(coverColorCache.keys().next().value);
  return colorPromise;
}

async function getPlaybackChannel(guild) {
  if (guild.id !== PLAYBACK_GUILD_ID) {
    throw new Error('Playback announcements are configured for a different Discord server.');
  }
  const channel = await client.channels.fetch(PLAYBACK_CHANNEL_ID);
  if (!channel || !channel.isTextBased() || channel.guildId !== PLAYBACK_GUILD_ID) {
    throw new Error('The configured playback announcement channel is unavailable or is not a text channel.');
  }
  return channel;
}

async function searchYouTube(query) {
  const result = await youtubeDl(`ytsearch1:${query}`, {
    dumpSingleJson: true,
    skipDownload: true,
    noWarnings: true,
    noPlaylist: true
  });
  const video = result.entries?.find((entry) => entry.id && entry.webpage_url);
  if (!video) return null;
  const artist = cleanTitle(video.artist || video.channel || video.uploader || '');
  const track = getTrackDetails(video.track || video.title, artist);
  return {
    ...track,
    url: video.webpage_url,
    thumbnail: getThumbnail(video.thumbnail)
  };
}

async function resolveSource(query) {
  const trimmed = query.trim();
  if (!trimmed) throw new Error('Enter a song name or link.');

  if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(trimmed)) {
    const metadata = await youtubeDl(trimmed, {
      dumpSingleJson: true,
      skipDownload: true,
      noWarnings: true
    });
    const entries = metadata.entries?.filter((entry) => entry.id && (entry.webpage_url || entry.url));
    if (entries) {
      return {
        items: entries.map((entry) => {
          const artist = entry.artist || entry.channel || entry.uploader || '';
          return {
            ...getTrackDetails(entry.track || entry.title, artist),
            url: entry.webpage_url || entry.url,
            thumbnail: getThumbnail(entry.thumbnail)
          };
        }),
        total: entries.length,
        source: 'YouTube playlist'
      };
    }
    const artist = cleanTitle(metadata.artist || metadata.channel || metadata.uploader || '');
    return {
      items: [{
        ...getTrackDetails(metadata.track || metadata.title, artist),
        url: metadata.webpage_url || trimmed,
        thumbnail: getThumbnail(metadata.thumbnail)
      }]
    };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    throw new Error('Use a YouTube link or a song name.');
  }

  const track = await searchYouTube(trimmed);
  if (!track) throw new Error(`No matching YouTube video was found for "${trimmed}".`);
  return { items: [track] };
}

function getGuildState(guildId) {
  if (!queue.has(guildId)) {
    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause }
    });
    player.on(AudioPlayerStatus.Idle, async () => {
      const state = queue.get(guildId);
      if (!state) return;
      state.songs.shift();
      state.failedSong = null;
      state.resource = null;
      if (state.songs.length) {
        await playNext(guildId);
      } else {
        state.playing = false;
      }
    });
    player.on('error', (error) => {
      const state = queue.get(guildId);
      const song = state?.songs[0];
      if (song) reportPlaybackFailure(state, song, error);
    });
    queue.set(guildId, {
      songs: [],
      connection: null,
      player,
      textChannel: null,
      playing: false,
      failedSong: null,
      resource: null,
      volume: 100,
      volumeBeforeMute: 100
    });
  }
  return queue.get(guildId);
}

function reportPlaybackFailure(state, song, error) {
  if (state.songs[0] !== song || state.failedSong === song) return;
  state.failedSong = song;
  console.error(`Playback failed for "${song.title}":`, error.message);
  state.textChannel?.send({
    embeds: [makeEmbed('Playback error', `Could not stream "${song.title}". Skipping to the next track.`)]
  }).catch((sendError) => {
    console.error('Could not send playback error announcement:', sendError.message);
  });
  state.player.stop(true);
}

async function ensureVoiceConnection(guildId, voiceChannel, textChannel) {
  const state = getGuildState(guildId);
  state.textChannel = textChannel || state.textChannel;
  if (!state.connection || state.connection.joinConfig.channelId !== voiceChannel.id) {
    state.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator
    });
  }
  return state;
}

async function playNext(guildId) {
  const state = getGuildState(guildId);
  if (!state.songs.length) {
    state.playing = false;
    return;
  }

  const song = state.songs[0];
  state.playing = true;
  let process;
  try {
    await addYouTubeMusicArtwork(song);
    process = youtubeDl.exec(song.url, {
      format: 'bestaudio/best',
      output: '-',
      quiet: true,
      noWarnings: true,
      noPlaylist: true
    });
    process.stderr.on('data', (data) => {
      console.warn(`yt-dlp: ${data.toString().trim()}`);
    });
    process.catch((error) => {
      reportPlaybackFailure(state, song, error);
    });
    state.connection?.subscribe(state.player);
    state.resource = createAudioResource(process.stdout, { inlineVolume: true });
    state.resource.volume.setVolume(state.volume / 100);
    state.player.play(state.resource);
  } catch (error) {
    process?.kill();
    console.error(`Failed to play ${song.url}:`, error.message);
    state.songs.shift();
    if (state.songs.length) await playNext(guildId);
    else state.playing = false;
    return;
  }
  try {
    const color = await getCoverColor(song.thumbnail);
    await state.textChannel?.send({
      embeds: [makePlaybackLogEmbed(song, color, 'now-playing')],
      components: [volumeControls()]
    });
  } catch (error) {
    console.error('Could not send now-playing announcement:', error.message);
  }
}

async function enqueue(guild, voiceChannel, resolved) {
  const textChannel = await getPlaybackChannel(guild);
  const state = await ensureVoiceConnection(guild.id, voiceChannel, textChannel);
  const available = Math.max(0, MAX_QUEUE_SIZE - state.songs.length);
  const songs = resolved.items.slice(0, available).map((item) => ({
    title: cleanTitle(item.title),
    artist: cleanTitle(item.artist || ''),
    url: item.url,
    thumbnail: getThumbnail(item.thumbnail),
    artworkSearched: false
  }));
  if (!songs.length) throw new Error(`The queue is full (maximum ${MAX_QUEUE_SIZE} tracks).`);

  await addYouTubeMusicArtwork(songs[0]);
  const color = await getCoverColor(songs[0].thumbnail);
  state.songs.push(...songs);
  if (!state.playing) await playNext(guild.id);
  await textChannel.send({
    embeds: [makePlaybackLogEmbed(songs[0], color, 'queued')],
    components: [volumeControls()]
  });
  return { songs, color };
}

async function handlePlay(query, guild, member) {
  const voiceChannel = member?.voice?.channel;
  if (!voiceChannel) throw new Error('Join a voice channel first.');
  const resolved = await resolveSource(query);
  return enqueue(guild, voiceChannel, resolved);
}

function makePlayConfirmation(result) {
  return makeTrackEmbed(result.songs[0], result.color);
}

function helpEmbed() {
  return new EmbedBuilder()
    .setColor(DEFAULT_EMBED_COLOR)
    .setTitle('Musictrix')
    .setDescription('Quick command guide · YouTube audio playback')
    .addFields(
      {
        name: 'Music',
        value: '`-play <song or YouTube link>`\n`/play <song or YouTube link>`',
        inline: false
      },
      {
        name: 'Playback',
        value: '`-join` · `/join`  `-pause` · `/pause`  `-resume` · `/resume`\n`-skip` · `/skip`  `-queue` · `/queue`\n`-remove <number or title>`  `-stop` · `/stop`  `-leave` · `/leave`',
        inline: false
      },
      {
        name: 'Chat & info',
        value: '`-<message>` or mention the bot to chat\n`-ping` · `-invite` · `-server` · `-help`',
        inline: false
      },
      {
        name: 'Moderation',
        value: '`-kick/-ki <member> [reason]` · `-ban/-ba <member> [reason]` · `-unban/-ub <user ID> [reason]`\n`-timeout/-to <member> <duration> [reason]` · `-untimeout/-uto <member> [reason]`\n`-purge/-pu <1-100>` · `-antimessage/-am add/remove/list`',
        inline: false
      }
    )
    .setFooter({ text: 'Prefix commands work in server text channels' });
}

function getBotContext(guildId) {
  const state = queue.get(guildId);
  const commands = [
    'Text commands: -play <song name, YouTube video URL, or playlist URL>; -join; -pause; -resume; -skip; -queue; -remove <queue number or song title>; -stop; -leave; -help; -ping; -invite; -server.',
    '-play searches YouTube and queues tracks or playlist entries. -remove removes a matching queued song; use a queue number if a title is ambiguous. Removing the playing song advances playback. -queue shows queued tracks. -stop clears the queue and stops playback; -leave disconnects from voice. -skip advances to the next track. -pause and -resume control the current track. -join connects to the caller’s voice channel.',
    '-ping reports message and gateway latency. -invite shares the Musictrix bot invite link. -server shares the bot owner’s server invite. -help displays the command guide.',
    'Slash commands: /play <query>, /join, /pause, /resume, /skip, /queue, /stop, /leave, /help. Slash commands do not include moderation or -remove.',
    'Moderation commands (and equivalent aliases): -kick/-ki <member> [reason], -ban/-ba <member> [reason], -unban/-ub <user ID> [reason], -timeout/-to <member> <duration> [reason], -untimeout/-uto <member> [reason], -purge/-pu <1-100>.',
    'Kick requires Kick Members; ban and unban require Ban Members; timeout and untimeout require Moderate Members; purge requires Manage Messages. For kick, ban, timeout, and untimeout, moderators cannot act on themselves or members at/elevated above their role; the bot must have the needed permission and role hierarchy. Unban takes a Discord user ID. Timeout duration units are s, m, h, d, or w, with a maximum of 28 days. Purge deletes 1 to 100 recent messages.',
    'Auto-purge commands: -antimessage/-am add <word or phrase>, -antimessage/-am remove <word or phrase>, -antimessage/-am list. Manage Messages is required to manage the list. Each server has up to 100 persisted terms; matching is case-insensitive, whole-word for words, and exact-phrase for phrases. Matching messages are automatically deleted if the bot has Manage Messages.',
    `Successful moderation actions, purges, auto-purged messages, and auto-purge list changes are logged in channel ${MODERATION_LOG_CHANNEL_ID}.`,
    'Playback controls include volume-down, mute/unmute, and volume-up buttons on track messages; volume ranges from 0% to 100% in 10% steps.'
  ];
  const details = [
    'Musictrix is a Discord music bot and chat assistant. Users can chat by mentioning the bot or sending -<message>; chatbot replies are regular text. The bot can explain commands but cannot execute commands on a user’s behalf.',
    'Music search and audio playback use YouTube through yt-dlp and Discord voice. Matching YouTube Music song metadata supplies album-cover artwork when available. Spotify and Apple Music integrations are not present.',
    `The per-server queue holds at most ${MAX_QUEUE_SIZE} tracks. Playback failures are announced and the bot skips to the next track.`,
    `Music playback is restricted to Discord server ${PLAYBACK_GUILD_ID}. Queue and now-playing announcements go to channel ${PLAYBACK_CHANNEL_ID}.`,
    ...commands
  ];

  if (!state) {
    details.push('Live playback state: no queue/player state has been created for this server yet.');
    return details.join('\n');
  }

  const current = state.playing ? state.songs[0] : null;
  details.push(`Live playback state: ${state.songs.length} of ${MAX_QUEUE_SIZE} queue slots are in use.`);
  details.push(current
    ? `Currently playing: ${current.title}.`
    : state.songs.length
      ? `Nothing is currently marked as playing; next queued track: ${state.songs[0].title}.`
      : 'Nothing is currently playing and the queue is empty.');
  if (state.songs.length > 1) {
    details.push(`Next in queue: ${state.songs.slice(current ? 1 : 0, 6).map((song) => song.title).join('; ')}.`);
  }
  return details.join('\n');
}

function findQueuedSongIndex(songs, query) {
  const trimmed = query.trim();
  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed) - 1;
    if (index < 0 || index >= songs.length) {
      throw new Error(`Choose a queue number from 1 to ${songs.length}.`);
    }
    return index;
  }
  if (!trimmed) throw new Error('Use `-remove <queue number or song title>`.');

  const normalized = trimmed.toLocaleLowerCase();
  const exactMatches = songs
    .map((song, index) => ({ song, index }))
    .filter(({ song }) => song.title.toLocaleLowerCase() === normalized);
  const matches = exactMatches.length
    ? exactMatches
    : songs
      .map((song, index) => ({ song, index }))
      .filter(({ song }) => `${song.title} ${song.artist}`.toLocaleLowerCase().includes(normalized));

  if (!matches.length) throw new Error(`No queued song matches “${trimmed}”.`);
  if (matches.length > 1) {
    throw new Error(`“${trimmed}” matches multiple songs. Use a queue number with \`-remove <number>\`.`);
  }
  return matches[0].index;
}

async function removeQueuedSong(state, query, guildId) {
  if (!state.songs.length) throw new Error('The queue is empty.');
  const index = findQueuedSongIndex(state.songs, query);
  const [song] = state.songs.slice(index, index + 1);

  if (index === 0 && state.playing) {
    state.player.stop();
  } else {
    state.songs.splice(index, 1);
    if (index === 0 && state.songs.length && !state.playing) {
      await playNext(guildId);
    }
  }
  return song;
}

async function replyError(channel, error, label) {
  console.error(`${label}:`, error.message);
  await channel.send({
    embeds: [makeEmbed('Playback error', error.message, WARNING_EMBED_COLOR)]
  });
}

function queueEmbed(songs, playing) {
  const visibleSongs = songs.slice(0, 20);
  const description = visibleSongs.map((song, index) => {
    const marker = playing && index === 0 ? '**Now playing** · ' : '';
    const artist = song.artist ? ` — ${song.artist}` : '';
    return `${marker}${index + 1}. ${song.title}${artist}`;
  }).join('\n');
  const embed = makeEmbed('Music queue', description);
  if (songs.length > visibleSongs.length) {
    embed.setFooter({ text: `Showing ${visibleSongs.length} of ${songs.length} tracks` });
  } else {
    embed.setFooter({ text: `${songs.length} track${songs.length === 1 ? '' : 's'}` });
  }
  return embed;
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.guild) return;
  const content = message.content.trim();
  if (content.startsWith(PREFIX)) {
    const [antiMessageCommand, ...antiMessageArgs] = content.slice(PREFIX.length).trim().split(/\s+/);
    const logAction = (entry) => logModerationAction(client, message.guild, entry);
    if (await handleAntiMessageCommand(message, antiMessageCommand, antiMessageArgs, logAction)) {
      return;
    }
  }
  const logAction = (entry) => logModerationAction(client, message.guild, entry);
  if (await filterAntiMessage(message, logAction)) {
    return;
  }
  if (!content.startsWith(PREFIX) && client.user && message.mentions.has(client.user)) {
    const prompt = content.replace(new RegExp(`<@!?${client.user.id}>`, 'g'), '').trim();
    if (!prompt) {
      return message.reply('Mention me with a message or question and I will reply.');
    }
    try {
      await message.channel.sendTyping();
      const reply = await getChatReply(prompt, getBotContext(message.guild.id));
      await message.reply({ content: reply, allowedMentions: { parse: [] } });
    } catch (error) {
      console.error('Chat reply failed:', error.message);
      await message.reply({
        content: `Chat is unavailable: ${error.message}`,
        allowedMentions: { parse: [] }
      });
    }
    return;
  }
  if (!content.startsWith(PREFIX)) return;
  const [command, ...args] = content.slice(PREFIX.length).trim().split(/\s+/);
  const guildId = message.guild.id;

  if (await handleModerationCommand(message, command, args, logAction)) {
    return;
  }
  if (command === 'ping') {
    const gatewayLatency = Math.round(client.ws.ping);
    const messageLatency = Math.max(0, Date.now() - message.createdTimestamp);
    await message.reply(`Pong! Message: ${messageLatency}ms · Gateway: ${gatewayLatency}ms`);
  } else if (command === 'invite') {
    await message.reply({
      embeds: [
        makeEmbed('Invite Musictrix', '[Add Musictrix to your server](<' + BOT_INVITE_URL + '>)', 0x57f287)
          .setURL(BOT_INVITE_URL)
          .setFooter({ text: 'Bring music and chat to your Discord server' })
      ],
      allowedMentions: { parse: [] }
    });
  } else if (command === 'server') {
    await message.reply({ content: `Join the bot owner's server: ${OWNER_SERVER_URL}`, allowedMentions: { parse: [] } });
  } else if (command === 'help') {
    await message.reply({ embeds: [helpEmbed()] });
  } else if (command === 'play') {
    try {
      const result = await handlePlay(args.join(' '), message.guild, message.member);
      await message.reply({
        embeds: [makePlayConfirmation(result)],
        components: [volumeControls()]
      });
    } catch (error) {
      await replyError(message.channel, error, 'Play command failed');
    }
  } else if (command === 'join') {
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply({ embeds: [makeEmbed('Join a voice channel first', 'Then use `-join` again.', WARNING_EMBED_COLOR)] });
    }
    await ensureVoiceConnection(guildId, voiceChannel, message.channel);
    await message.reply({ embeds: [makeEmbed('Connected', `Joined **${voiceChannel.name}**.`, SUCCESS_EMBED_COLOR)] });
  } else if (command === 'pause' || command === 'resume') {
    const player = getGuildState(guildId).player;
    if (command === 'pause') player.pause();
    else player.unpause();
    await message.reply({
      embeds: [makeEmbed(
        command === 'pause' ? 'Playback paused' : 'Playback resumed',
        command === 'pause' ? 'The current track is paused.' : 'The current track is playing again.',
        SUCCESS_EMBED_COLOR
      )]
    });
  } else if (command === 'skip') {
    const state = getGuildState(guildId);
    if (!state.songs.length) {
      return message.reply({ embeds: [makeEmbed('Queue is empty', 'There is no track to skip.', WARNING_EMBED_COLOR)] });
    }
    state.player.stop();
    await message.reply({ embeds: [makeEmbed('Track skipped', 'Moving to the next track.', SUCCESS_EMBED_COLOR)] });
  } else if (command === 'remove') {
    try {
      const state = getGuildState(guildId);
      const song = await removeQueuedSong(state, args.join(' '), guildId);
      const color = await getCoverColor(song.thumbnail);
      const embed = makeEmbed('Removed from queue', `**${song.title}** has been removed from the queue.`, color);
      if (song.artist) embed.addFields({ name: 'Artist', value: song.artist });
      if (song.thumbnail) embed.setThumbnail(song.thumbnail);
      await message.reply({
        embeds: [embed]
      });
    } catch (error) {
      await message.reply({ embeds: [makeEmbed('Could not remove song', error.message, WARNING_EMBED_COLOR)] });
    }
  } else if (command === 'queue') {
    const state = getGuildState(guildId);
    if (!state.songs.length) {
      return message.reply({ embeds: [makeEmbed('Queue is empty', 'Add a track with `-play`.', WARNING_EMBED_COLOR)] });
    }
    await message.reply({ embeds: [queueEmbed(state.songs, state.playing)] });
  } else if (command === 'stop' || command === 'leave') {
    const state = getGuildState(guildId);
    if (command === 'stop') state.songs = [];
    state.player.stop();
    state.playing = false;
    if (state.connection) {
      state.connection.destroy();
      state.connection = null;
    }
    await message.reply({
      embeds: [makeEmbed(
        command === 'stop' ? 'Playback stopped' : 'Disconnected',
        command === 'stop' ? 'Playback stopped and the queue was cleared.' : 'Left the voice channel.',
        SUCCESS_EMBED_COLOR
      )]
    });
  } else {
    const prompt = content.slice(PREFIX.length).trim();
    if (!prompt) {
      return message.reply('Add a message after `-` and I will reply.');
    }
    try {
      await message.channel.sendTyping();
      const reply = await getChatReply(prompt, getBotContext(guildId));
      await message.reply({ content: reply, allowedMentions: { parse: [] } });
    } catch (error) {
      console.error('Chat reply failed:', error.message);
      await message.reply({
        content: `Chat is unavailable: ${error.message}`,
        allowedMentions: { parse: [] }
      });
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.guild) return;
  const { commandName } = interaction;
  const guildId = interaction.guild.id;

  if (interaction.isButton()) {
    if (!['music-volume-down', 'music-volume-mute', 'music-volume-up'].includes(interaction.customId)) return;
    const state = queue.get(guildId);
    if (!state?.playing || !state.resource?.volume) {
      await interaction.reply({
        embeds: [makeEmbed('No active song', 'Start a song before adjusting its volume.', WARNING_EMBED_COLOR)],
        ephemeral: true
      });
      return;
    }

    if (interaction.customId === 'music-volume-mute') {
      if (state.volume > 0) {
        state.volumeBeforeMute = state.volume;
        state.volume = 0;
      } else {
        state.volume = state.volumeBeforeMute || 100;
      }
    } else {
      const adjustment = interaction.customId === 'music-volume-up' ? VOLUME_STEP : -VOLUME_STEP;
      state.volume = Math.max(0, Math.min(100, state.volume + adjustment));
      if (state.volume > 0) state.volumeBeforeMute = state.volume;
    }
    state.resource.volume.setVolume(state.volume / 100);
    await interaction.reply({
      embeds: [makeEmbed(
        state.volume === 0 ? 'Playback muted' : 'Volume updated',
        state.volume === 0 ? 'Click **Mute** again to restore the previous volume.' : `Playback volume: **${state.volume}%**.`
      )],
      ephemeral: true
    });
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  if (commandName === 'help') {
    await interaction.reply({ embeds: [helpEmbed()], ephemeral: true });
  } else if (commandName === 'play') {
    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await handlePlay(
        interaction.options.getString('query'),
        interaction.guild,
        interaction.member
      );
      await interaction.editReply({
        embeds: [makePlayConfirmation(result)],
        components: [volumeControls()]
      });
    } catch (error) {
      console.error('Slash play command failed:', error.message);
      await interaction.editReply({
        embeds: [makeEmbed('Playback error', error.message, WARNING_EMBED_COLOR)]
      });
    }
  } else if (commandName === 'join') {
    const voiceChannel = interaction.member?.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({
        embeds: [makeEmbed('Join a voice channel first', 'Then use `/join` again.', WARNING_EMBED_COLOR)],
        ephemeral: true
      });
    }
    await ensureVoiceConnection(guildId, voiceChannel, interaction.channel);
    await interaction.reply({
      embeds: [makeEmbed('Connected', `Joined **${voiceChannel.name}**.`, SUCCESS_EMBED_COLOR)],
      ephemeral: true
    });
  } else if (commandName === 'pause' || commandName === 'resume') {
    const player = getGuildState(guildId).player;
    if (commandName === 'pause') player.pause();
    else player.unpause();
    await interaction.reply({
      embeds: [makeEmbed(
        commandName === 'pause' ? 'Playback paused' : 'Playback resumed',
        commandName === 'pause' ? 'The current track is paused.' : 'The current track is playing again.',
        SUCCESS_EMBED_COLOR
      )],
      ephemeral: true
    });
  } else if (commandName === 'skip') {
    const state = getGuildState(guildId);
    if (!state.songs.length) {
      return interaction.reply({
        embeds: [makeEmbed('Queue is empty', 'There is no track to skip.', WARNING_EMBED_COLOR)],
        ephemeral: true
      });
    }
    state.player.stop();
    await interaction.reply({
      embeds: [makeEmbed('Track skipped', 'Moving to the next track.', SUCCESS_EMBED_COLOR)],
      ephemeral: true
    });
  } else if (commandName === 'queue') {
    const state = getGuildState(guildId);
    if (!state.songs.length) {
      return interaction.reply({
        embeds: [makeEmbed('Queue is empty', 'Add a track with `/play`.', WARNING_EMBED_COLOR)],
        ephemeral: true
      });
    }
    await interaction.reply({ embeds: [queueEmbed(state.songs, state.playing)] });
  } else if (commandName === 'stop' || commandName === 'leave') {
    const state = getGuildState(guildId);
    if (commandName === 'stop') state.songs = [];
    state.player.stop();
    state.playing = false;
    if (state.connection) {
      state.connection.destroy();
      state.connection = null;
    }
    await interaction.reply({
      embeds: [makeEmbed(
        commandName === 'stop' ? 'Playback stopped' : 'Disconnected',
        commandName === 'stop' ? 'Playback stopped and the queue was cleared.' : 'Left the voice channel.',
        SUCCESS_EMBED_COLOR
      )]
    });
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Missing DISCORD_TOKEN in .env. Copy .env.example to .env and add your bot token.');
  process.exit(1);
}

client.login(token);
