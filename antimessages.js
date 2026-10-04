const fs = require('node:fs');
const path = require('node:path');
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const MAX_TERMS_PER_GUILD = 100;
const MAX_TERM_LENGTH = 100;
const DATA_FILE = path.join(__dirname, 'data', 'antimessages.json');

function loadTerms() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Anti-message data must be a guild-to-terms object.');
    }

    for (const [guildId, terms] of Object.entries(data)) {
      if (!/^\d{17,20}$/.test(guildId) || !Array.isArray(terms)
        || terms.some((term) => typeof term !== 'string')) {
        throw new Error('Anti-message data contains an invalid guild or term list.');
      }
    }
    return new Map(Object.entries(data));
  } catch (error) {
    if (error.code === 'ENOENT') return new Map();
    throw error;
  }
}

const termsByGuild = loadTerms();

function normalizeTerm(term) {
  return term.trim().replace(/\s+/g, ' ');
}

function hasManageMessagesPermission(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
    throw new Error('You need the **Manage Messages** permission to manage the auto-purge list.');
  }
}

function persistTerms(guildId, updatedTerms) {
  const updatedEntries = new Map(termsByGuild);
  if (updatedTerms.length) updatedEntries.set(guildId, updatedTerms);
  else updatedEntries.delete(guildId);

  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const temporaryFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(Object.fromEntries(updatedEntries), null, 2)}\n`);
  fs.renameSync(temporaryFile, DATA_FILE);
  termsByGuild.clear();
  for (const [id, terms] of updatedEntries) termsByGuild.set(id, terms);
}

function autoPurgeEmbed(title, description, color = 0x5865f2) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
}

async function handleAntiMessageCommand(message, command, args, logAction) {
  if (!['antimessage', 'am'].includes(command.toLowerCase())) return false;

  try {
    hasManageMessagesPermission(message);
    const action = (args[0] || '').toLowerCase();
    const guildTerms = termsByGuild.get(message.guild.id) || [];

    if (action === 'list') {
      if (!guildTerms.length) {
        await message.reply({
          embeds: [autoPurgeEmbed('Auto-purge words', 'No blocked words or phrases are configured.')],
          allowedMentions: { parse: [] }
        });
        return true;
      }

      const pages = [];
      for (let index = 0; index < guildTerms.length; index += 20) {
        const pageTerms = guildTerms.slice(index, index + 20);
        pages.push(autoPurgeEmbed(
          `Auto-purge words (${index + 1}-${index + pageTerms.length} of ${guildTerms.length})`,
          pageTerms.map((term) => `• ${term.replace(/[\r\n]/g, ' ')}`).join('\n')
        ));
      }
      await message.reply({ embeds: pages, allowedMentions: { parse: [] } });
      return true;
    }

    if (action !== 'add' && action !== 'remove') {
      throw new Error('Use `-antimessage add <word or phrase>`, `-antimessage remove <word or phrase>`, or `-antimessage list`.');
    }

    const term = normalizeTerm(args.slice(1).join(' '));
    if (!term || term.length > MAX_TERM_LENGTH) {
      throw new Error(`Provide a word or phrase between 1 and ${MAX_TERM_LENGTH} characters.`);
    }

    const existingIndex = guildTerms.findIndex((entry) => entry.toLowerCase() === term.toLowerCase());
    if (action === 'add') {
      if (existingIndex !== -1) throw new Error('That word or phrase is already on the auto-purge list.');
      if (guildTerms.length >= MAX_TERMS_PER_GUILD) {
        throw new Error(`The auto-purge list is limited to ${MAX_TERMS_PER_GUILD} entries per server.`);
      }
      const updatedTerms = [...guildTerms, term];
      persistTerms(message.guild.id, updatedTerms);
      await logAction({
        action: 'Auto-purge term added',
        actor: message.author,
        details: term
      });
      await message.reply({
        embeds: [autoPurgeEmbed('Auto-purge word added', `Messages containing **${term}** will be deleted.`)],
        allowedMentions: { parse: [] }
      });
    } else {
      if (existingIndex === -1) throw new Error('That word or phrase is not on the auto-purge list.');
      const updatedTerms = guildTerms.filter((_, index) => index !== existingIndex);
      persistTerms(message.guild.id, updatedTerms);
      await logAction({
        action: 'Auto-purge term removed',
        actor: message.author,
        details: term
      });
      await message.reply({
        embeds: [autoPurgeEmbed('Auto-purge word removed', `Messages containing **${term}** will no longer be auto-deleted.`)],
        allowedMentions: { parse: [] }
      });
    }
  } catch (error) {
    console.error('Anti-message command failed:', error.message);
    await message.reply({
      embeds: [autoPurgeEmbed('Auto-purge command failed', error.message, 0xed4245)],
      allowedMentions: { parse: [] }
    });
  }

  return true;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function filterAntiMessage(message, logAction) {
  const guildTerms = termsByGuild.get(message.guild.id) || [];
  if (!guildTerms.length) return false;

  const normalizedContent = message.content.replace(/\s+/g, ' ');
  const matchedTerm = guildTerms.find((term) => {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`,
      'iu'
    );
    return pattern.test(normalizedContent);
  });
  if (!matchedTerm) return false;

  try {
    await message.delete();
    await logAction({
      action: 'Auto-purged message',
      actor: message.client.user,
      target: `${message.author.tag || message.author.username} (${message.author.id})`,
      channel: message.channel,
      details: `Matched term: ${matchedTerm}`
    });
  } catch (error) {
    console.error(`Could not auto-delete a message matching "${matchedTerm}":`, error.message);
  }
  return true;
}

module.exports = { filterAntiMessage, handleAntiMessageCommand };
