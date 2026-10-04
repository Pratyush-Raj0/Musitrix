const { EmbedBuilder } = require('discord.js');

const MODERATION_LOG_CHANNEL_ID = '1473349548670976183';

function fieldValue(value, fallback = 'Not provided') {
  const text = String(value || fallback);
  return text.length > 1024 ? `${text.slice(0, 1021)}...` : text;
}

async function logModerationAction(client, guild, {
  action,
  actor,
  target,
  reason,
  channel,
  details
}) {
  try {
    const logChannel = await client.channels.fetch(MODERATION_LOG_CHANNEL_ID);
    if (!logChannel?.isTextBased() || !logChannel.guildId) {
      throw new Error(`Moderation log channel ${MODERATION_LOG_CHANNEL_ID} is unavailable or not a text channel.`);
    }

    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(`MODERATION · ${action}`)
      .addFields(
        { name: 'Server', value: fieldValue(`${guild.name} (${guild.id})`) },
        { name: 'Moderator', value: fieldValue(`${actor.tag || actor.username || actor.id} (${actor.id})`) },
        ...(target ? [{ name: 'Target', value: fieldValue(target) }] : []),
        ...(reason ? [{ name: 'Reason', value: fieldValue(reason) }] : []),
        ...(channel ? [{ name: 'Channel', value: fieldValue(`${channel.name || 'unknown'} (${channel.id})`) }] : []),
        ...(details ? [{ name: 'Details', value: fieldValue(details) }] : [])
      )
      .setTimestamp();

    await logChannel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (error) {
    console.error(`Could not send moderation log for "${action}":`, error.message);
  }
}

module.exports = { logModerationAction, MODERATION_LOG_CHANNEL_ID };
