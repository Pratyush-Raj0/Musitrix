const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const SUCCESS_COLOR = 0x57f287;
const ERROR_COLOR = 0xed4245;
const MODERATION_COMMANDS = new Set(['kick', 'ban', 'unban', 'timeout', 'untimeout', 'purge']);
const MODERATION_ALIASES = new Map([
  ['ki', 'kick'],
  ['ba', 'ban'],
  ['ub', 'unban'],
  ['to', 'timeout'],
  ['uto', 'untimeout'],
  ['pu', 'purge']
]);
const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

function moderationEmbed(title, description, color = SUCCESS_COLOR) {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
}

async function reply(message, title, description, color) {
  await message.reply({ embeds: [moderationEmbed(title, description, color)] });
}

function getDuration(value) {
  const match = /^(\d+)(s|m|h|d|w)$/i.exec(value || '');
  if (!match) throw new Error('Use a duration like `10m`, `2h`, or `1d`.');

  const factors = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 };
  const duration = Number(match[1]) * factors[match[2].toLowerCase()];
  if (!Number.isSafeInteger(duration) || duration < 1000 || duration > MAX_TIMEOUT_MS) {
    throw new Error('Timeout duration must be between 1 second and 28 days.');
  }
  return duration;
}

async function getTargetMember(message, token) {
  const id = getUserId(token);
  if (!id) throw new Error('Mention a server member or provide their user ID.');

  try {
    return await message.guild.members.fetch(id);
  } catch (error) {
    if (error.code === 10007) throw new Error('That member could not be found in this server.');
    throw error;
  }
}

function getUserId(token) {
  const mentionId = /^<@!?(\d+)>$/.exec(token || '')?.[1];
  const id = mentionId || token;
  return /^\d{17,20}$/.test(id || '') ? id : null;
}

function assertCanModerate(message, target) {
  if (target.id === message.author.id) throw new Error('You cannot moderate yourself.');
  if (target.id === message.client.user.id) throw new Error('I cannot moderate myself.');
  if (message.author.id !== message.guild.ownerId
    && target.roles.highest.comparePositionTo(message.member.roles.highest) >= 0) {
    throw new Error('You can only moderate members whose highest role is below yours.');
  }
}

function assertPermission(message, permission, label) {
  if (!message.member.permissions.has(permission)) {
    throw new Error(`You need the **${label}** permission to use this command.`);
  }
}

async function handleModerationCommand(message, command, args, logAction) {
  command = MODERATION_ALIASES.get(command) || command;
  if (!MODERATION_COMMANDS.has(command)) return false;

  try {
    if (command === 'purge') {
      assertPermission(message, PermissionFlagsBits.ManageMessages, 'Manage Messages');
      const botPermissions = message.guild.members.me?.permissionsIn(message.channel);
      if (!botPermissions?.has(PermissionFlagsBits.ManageMessages)) {
        throw new Error('I need the **Manage Messages** permission in this channel.');
      }
      if (!message.channel.isTextBased() || typeof message.channel.bulkDelete !== 'function') {
        throw new Error('This command only works in a server text channel.');
      }

      const countText = args[0] || '';
      const count = Number(countText);
      if (!/^\d+$/.test(countText) || !Number.isInteger(count) || count < 1 || count > 100) {
        throw new Error('Use `-purge <1-100>` to choose how many recent messages to delete.');
      }
      const deleted = await message.channel.bulkDelete(count, true);
      await logAction({
        action: 'Messages purged',
        actor: message.author,
        channel: message.channel,
        details: `${deleted.size} recent messages deleted`
      });
      const confirmation = await message.channel.send({
        embeds: [moderationEmbed('Messages purged', `Deleted **${deleted.size}** recent messages.`)]
      });
      setTimeout(() => {
        confirmation.delete().catch((error) => {
          console.warn('Could not delete purge confirmation:', error.message);
        });
      }, 5000).unref?.();
      return true;
    }

    const permission = command === 'kick'
      ? PermissionFlagsBits.KickMembers
      : command === 'timeout' || command === 'untimeout'
        ? PermissionFlagsBits.ModerateMembers
        : PermissionFlagsBits.BanMembers;
    const permissionLabel = command === 'kick'
      ? 'Kick Members'
      : command === 'timeout' || command === 'untimeout'
        ? 'Moderate Members'
        : 'Ban Members';
    assertPermission(message, permission, permissionLabel);

    if (command === 'unban') {
      if (args.length < 1) throw new Error('Use `-unban <user ID> [reason]`.');
      const userId = getUserId(args[0]);
      if (!userId) throw new Error('Provide the banned user’s Discord ID. Mentions do not work for users who are not in the server.');
      if (!message.guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers)) {
        throw new Error('I need the **Ban Members** permission to unban users.');
      }

      let ban;
      try {
        ban = await message.guild.bans.fetch(userId);
      } catch (error) {
        if (error.code === 10026) throw new Error('That user is not banned in this server.');
        throw error;
      }
      const reason = args.slice(1).join(' ').trim().slice(0, 450) || `Action by ${message.author.tag}`;
      await message.guild.bans.remove(userId, reason);
      await logAction({
        action: 'User unbanned',
        actor: message.author,
        target: `${ban.user.tag} (${userId})`,
        reason
      });
      await reply(message, 'User unbanned', `**${ban.user.tag}** was unbanned.\nReason: ${reason}`);
      return true;
    }

    if (command === 'timeout' && args.length < 2) {
      throw new Error('Use `-timeout <member> <duration> [reason]`, for example `-timeout @member 10m spamming`.');
    }
    if ((command === 'kick' || command === 'ban' || command === 'untimeout') && args.length < 1) {
      throw new Error(`Use \`-${command} <member> [reason]\`.`);
    }

    const target = await getTargetMember(message, args[0]);
    assertCanModerate(message, target);
    const reasonIndex = command === 'timeout' ? 2 : 1;
    const reason = args.slice(reasonIndex).join(' ').trim().slice(0, 450) || `Action by ${message.author.tag}`;

    if (command === 'kick') {
      if (!target.kickable) throw new Error('I cannot kick that member. Check my role position and Kick Members permission.');
      await target.kick(reason);
      await logAction({
        action: 'Member kicked',
        actor: message.author,
        target: `${target.user.tag} (${target.id})`,
        reason
      });
      await reply(message, 'Member kicked', `**${target.user.tag}** was kicked.\nReason: ${reason}`);
    } else if (command === 'ban') {
      if (!target.bannable) throw new Error('I cannot ban that member. Check my role position and Ban Members permission.');
      await target.ban({ reason });
      await logAction({
        action: 'Member banned',
        actor: message.author,
        target: `${target.user.tag} (${target.id})`,
        reason
      });
      await reply(message, 'Member banned', `**${target.user.tag}** was banned.\nReason: ${reason}`);
    } else if (command === 'timeout') {
      if (!target.moderatable) throw new Error('I cannot timeout that member. Check my role position and Moderate Members permission.');
      const duration = getDuration(args[1]);
      await target.timeout(duration, reason);
      await logAction({
        action: 'Member timed out',
        actor: message.author,
        target: `${target.user.tag} (${target.id})`,
        reason,
        details: `Duration: ${args[1]}`
      });
      await reply(
        message,
        'Member timed out',
        `**${target.user.tag}** was timed out for **${args[1]}**.\nReason: ${reason}`
      );
    } else {
      if (!target.moderatable) throw new Error('I cannot change that member’s timeout. Check my role position and Moderate Members permission.');
      await target.timeout(null, reason);
      await logAction({
        action: 'Member timeout removed',
        actor: message.author,
        target: `${target.user.tag} (${target.id})`,
        reason
      });
      await reply(message, 'Timeout removed', `The timeout was removed for **${target.user.tag}**.\nReason: ${reason}`);
    }
  } catch (error) {
    console.warn(`Moderation command -${command} failed:`, error.message);
    await reply(message, 'Moderation action failed', error.message, ERROR_COLOR);
  }

  return true;
}

module.exports = { handleModerationCommand };
