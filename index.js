import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";

// ================= CONFIG =================
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

// Channel #daftar-fashion-show
const DAFTAR_CHANNEL_ID = process.env.DAFTAR_CHANNEL_ID;

// Channel #peserta-fashion-show
const PESERTA_CHANNEL_ID = process.env.PESERTA_CHANNEL_ID;

// Optional: user ID owner untuk tulisan "hubungi @ownerdiscord"
const OWNER_USER_ID = process.env.OWNER_USER_ID || OWNER_USER_ID;

const STORE_FOOTER = "UNDERCOVER - List Fashion Show";
const DEFAULT_QUOTA = 35;

if (!DISCORD_TOKEN) throw new Error("Missing DISCORD_TOKEN");
if (!GUILD_ID) throw new Error("Missing GUILD_ID");
if (!DAFTAR_CHANNEL_ID) throw new Error("Missing DAFTAR_CHANNEL_ID");
if (!PESERTA_CHANNEL_ID) throw new Error("Missing PESERTA_CHANNEL_ID");
if (!OWNER_USER_ID) throw new Error("Missing OWNER_USER_ID");

// ================= STORAGE =================
const DATA_FILE = path.resolve("./fashion_show.json");

const db = {
  panelMessageId: null,
  listMessageId: null,
  quota: DEFAULT_QUOTA,
  participants: [],
};

const pendingConfirmations = new Map();

function loadDb() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;

    const raw = fs.readFileSync(DATA_FILE, "utf-8");
    const json = JSON.parse(raw);

    db.panelMessageId = json.panelMessageId || null;
    db.listMessageId = json.listMessageId || null;
    db.quota = Number.isFinite(Number(json.quota)) ? Number(json.quota) : DEFAULT_QUOTA;
    db.participants = Array.isArray(json.participants) ? json.participants : [];

    if (db.quota < 1) db.quota = DEFAULT_QUOTA;
  } catch (e) {
    console.error("Failed to load fashion_show.json:", e);
  }
}

function saveDb() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error("Failed to save fashion_show.json:", e);
  }
}

function nowIso() {
  return new Date().toISOString();
}

function cleanUsername(input) {
  return String(input || "")
    .trim()
    .replace(/^@/, "")
    .replace(/\s+/g, "");
}

function isOwner(member) {
  if (!member) return false;

  return (
    member.roles.cache.has(OWNER_USER_ID) ||
    member.permissions.has(PermissionsBitField.Flags.Administrator)
  );
}

function getUsedQuota() {
  return db.participants.length;
}

function getRemainingQuota() {
  return Math.max(0, Number(db.quota || DEFAULT_QUOTA) - getUsedQuota());
}

function isQuotaFull() {
  return getUsedQuota() >= Number(db.quota || DEFAULT_QUOTA);
}

function getQuotaText() {
  const used = getUsedQuota();
  const quota = Number(db.quota || DEFAULT_QUOTA);
  const remaining = Math.max(0, quota - used);

  if (used >= quota) {
    return `⛔ **KUOTA PENUH** — ${used}/${quota} peserta terdaftar`;
  }

  return `✅ **KUOTA TERSEDIA** — ${used}/${quota} peserta terdaftar\n🎟️ **Sisa Kuota:** ${remaining} peserta`;
}

// ================= ROBLOX CHECK =================
async function getRobloxUser(username) {
  const clean = cleanUsername(username);
  if (!clean) return null;

  const r = await fetch("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "UNDERCOVER-FashionShowBot/1.0",
    },
    body: JSON.stringify({
      usernames: [clean],
      excludeBannedUsers: true,
    }),
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Roblox username check failed: ${r.status} ${t}`);
  }

  const json = await r.json();
  const user = json?.data?.[0];
  if (!user?.id) return null;

  const thumb = await getRobloxAvatarHeadshot(user.id).catch(() => null);

  return {
    id: user.id,
    username: user.name,
    displayName: user.displayName,
    profileUrl: `https://www.roblox.com/users/${user.id}/profile`,
    avatarUrl: thumb,
  };
}

async function getRobloxAvatarHeadshot(userId) {
  const url =
    `https://thumbnails.roblox.com/v1/users/avatar-headshot` +
    `?userIds=${encodeURIComponent(userId)}` +
    `&size=420x420&format=Png&isCircular=false`;

  const r = await fetch(url, {
    headers: {
      "User-Agent": "UNDERCOVER-FashionShowBot/1.0",
    },
  });

  if (!r.ok) return null;

  const json = await r.json();
  return json?.data?.[0]?.imageUrl || null;
}

// ================= TIKTOK HELPERS =================
// TikTok sengaja TIDAK divalidasi via fetch.
// Alasannya: TikTok sering block request bot/server, captcha, atau return error
// walaupun username benar. Jadi TikTok hanya dicek format dan dibuat link profil.
function buildTikTokUser(username) {
  const clean = cleanUsername(username);
  if (!clean) return null;

  return {
    username: clean,
    profileUrl: `https://www.tiktok.com/@${encodeURIComponent(clean)}`,
    avatarUrl: null,
  };
}

// ================= EMBEDS / COMPONENTS =================
function buildPanelEmbed() {
  const quotaStatus = getQuotaText();

  return new EmbedBuilder()
    .setColor(isQuotaFull() ? 0xef4444 : 0x8b5cf6)
    .setTitle("⚡ UNDERCOVER FASHION SHOW ⚡")
    .setDescription(
      [
        "## 🎭 Special Streamer: **k1ddoR2G**",
        "",
        "Halo warga **Undercover Society**! 🖤💜",
        "Saatnya tunjukkan style terbaik kalian di acara **FASHION SHOW UNDERCOVER** dengan vibes underground, bold, dan penuh karakter! 🔥",
        "",
        "━━━━━━━━━━━━━━━━━━━━━━",
        "",
        "## 🎟️ STATUS KUOTA REALTIME",
        "",
        quotaStatus,
        "",
        "━━━━━━━━━━━━━━━━━━━━━━",
        "",
        "## 📅 DETAIL ACARA",
        "",
        "🗓️ **Tanggal:** 9 Juni 2026",
        "⏰ **Waktu:** 20:00 WIB",
        "📍 **Tempat:** UNDERCOVER Society Map",
        "🎟️ **Pendaftaran:** **GRATIS!**",
        "⚠️ **KUOTA TERBATAS**",
        "",
        "━━━━━━━━━━━━━━━━━━━━━━",
        "",
        "## 🏆 HADIAH PEMENANG",
        "",
        "🥇 **Juara 1:** 1500 Robux",
        "🥈 **Juara 2:** 1000 Robux",
        "🥉 **Juara 3:** 500 Robux",
        "",
        "━━━━━━━━━━━━━━━━━━━━━━",
        "",
        "## 📝 PENDAFTARAN",
        "",
        "Pendaftaran bisa langsung melalui:",
        "💬 **Discord Undercover Society**",
        "🎵 **TikTok Undercover Society**",
        "",
        "📌 **Dibuka:** 31 Mei 2026",
        "⛔ **Ditutup:** 9 Juni 2026, pukul 17:00 WIB",
        "",
        "🔗 **Link Discord:** https://discord.com/invite/undercoversociety",
        "🗺️ **Link Map:** https://www.roblox.com/share?code=356ea03a61669e4698ba9e8f5b4bf6d0&type=ExperienceDetails&stamp=1778818438541",
        "",
        "━━━━━━━━━━━━━━━━━━━━━━",
        "",
        "## 📌 KETENTUAN",
        "",
        "✅ Dress code bebas, tetapi **direkomendasikan Vintage Outfit**",
        "🚫 Tidak menggunakan outfit berbau **SARA / vulgar**",
        "🎁 Hadiah akan diberikan kepada peserta yang **terdaftar resmi**",
        "⚠️ Tidak melakukan kerusuhan. Jika terjadi kerusuhan, akan kami tindak lanjuti",
        "⚖️ Keputusan juri bersifat mutlak dan tidak dapat diganggu gugat",
        "🌐 Gangguan koneksi atau problem saat acara berlangsung bukan tanggung jawab panitia",
        "",
        "━━━━━━━━━━━━━━━━━━━━━━",
        "",
        "## 👑 SISTEM PEMENANG",
        "",
        "Pemenang akan ditentukan oleh juri berdasarkan penilaian saat acara berlangsung.",
        "📢 Daftar pemenang akan diinformasikan melalui **Discord** dan **TikTok Undercover Society**.",
        "",
        "━━━━━━━━━━━━━━━━━━━━━━",
        "",
        isQuotaFull()
          ? "⛔ **Kuota saat ini sudah penuh.** Tunggu info dari panitia jika kuota ditambah."
          : "🔥 **Jangan sampai ketinggalan!** Klik tombol **DAFTAR** di bawah untuk mendaftar.",
      ].join("\n")
    )
    .setFooter({ text: "UNDERCOVER - Fashion Show Registration" })
    .setTimestamp();
}

function buildPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("fs_open_register_modal")
        .setLabel(isQuotaFull() ? "KUOTA PENUH" : "DAFTAR")
        .setStyle(isQuotaFull() ? ButtonStyle.Danger : ButtonStyle.Success)
        .setDisabled(isQuotaFull())
    ),
  ];
}

function buildRegisterModal() {
  const modal = new ModalBuilder()
    .setCustomId("fs_register_modal_submit")
    .setTitle("Daftar Fashion Show");

  const robloxUsername = new TextInputBuilder()
    .setCustomId("roblox_username")
    .setLabel("Username Roblox tanpa @")
    .setPlaceholder("Contoh: vaelrynnn")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(20);

  const tiktokUsername = new TextInputBuilder()
    .setCustomId("tiktok_username")
    .setLabel("Username TikTok tanpa @ (opsional)")
    .setPlaceholder("Contoh: vaelryn123")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(30);

  modal.addComponents(
    new ActionRowBuilder().addComponents(robloxUsername),
    new ActionRowBuilder().addComponents(tiktokUsername)
  );

  return modal;
}

function buildRetryButton() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("fs_retry_register_modal")
        .setLabel("Isi Ulang Form")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(isQuotaFull())
    ),
  ];
}

function buildConfirmationEmbed(data) {
  const tiktokLine = data.tiktok
    ? `[${data.tiktok.username}](${data.tiktok.profileUrl})`
    : "_Tidak diisi_";

  return new EmbedBuilder()
    .setColor(0xfacc15)
    .setTitle("Konfirmasi Pendaftaran Fashion Show")
    .setDescription(
      [
        `Halo <@${data.discordUserId}> 👋`,
        "",
        "Apakah akun di bawah ini benar milik kamu?",
        "",
        `🎮 **Roblox Username:** [${data.roblox.username}](${data.roblox.profileUrl})`,
        `🏷️ **Roblox Display Name:** ${data.roblox.displayName || "-"}`,
        `🎵 **TikTok Username:** ${tiktokLine}`,
        "",
        `🎟️ **Status Kuota:** ${getUsedQuota()}/${db.quota}`,
        `📌 **Sisa Kuota:** ${getRemainingQuota()}`,
        "",
        "Klik **BENAR** jika sudah sesuai.",
        "Klik **SALAH / ISI ULANG** jika ada kesalahan.",
      ].join("\n")
    )
    .setThumbnail(data.roblox.avatarUrl || null)
    .setFooter({ text: "UNDERCOVER - Fashion Show Confirmation" });
}

function buildConfirmationButtons(confirmId) {
  const full = isQuotaFull();

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`fs_confirm_yes:${confirmId}`)
        .setLabel(full ? "KUOTA PENUH" : "BENAR")
        .setStyle(full ? ButtonStyle.Danger : ButtonStyle.Success)
        .setDisabled(full),
      new ButtonBuilder()
        .setCustomId(`fs_confirm_no:${confirmId}`)
        .setLabel("SALAH / ISI ULANG")
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

function buildListEmbed() {
  const desc = [];

  desc.push(`🎟️ **Kuota:** ${getUsedQuota()}/${db.quota}`);
  desc.push(`📌 **Sisa Kuota:** ${getRemainingQuota()}`);
  desc.push("");

  if (db.participants.length === 0) {
    desc.push("_Belum ada peserta yang terdaftar._");
  } else {
    db.participants.forEach((p, idx) => {
      desc.push(
        [
          `**${idx + 1}.**`,
          `**Discord :** <@${p.discordUserId}>`,
          `**Username Roblox :** ${p.robloxUsername}`,
          `**DisplayName Roblox :** ${p.robloxDisplayName || "-"}`,
          `**Username TikTok :** ${p.tiktokUsername || "-"}`,
        ].join("\n")
      );
    });
  }

  desc.push("");
  desc.push(
    `Jika ada kesalahan atau batal ikut pendaftaran segera hubungi ${
      OWNER_USER_ID ? `<@${OWNER_USER_ID}>` : "@ownerdiscord"
    }`
  );

  return new EmbedBuilder()
    .setColor(isQuotaFull() ? 0xef4444 : 0xa855f7)
    .setTitle("⚡ DAFTAR PESERTA FASHION SHOW UNDERCOVER ⚡")
    .setDescription(desc.join("\n\n"))
    .setFooter({ text: STORE_FOOTER })
    .setTimestamp();
}

// ================= DISCORD HELPERS =================
async function getGuild(client) {
  return client.guilds.fetch(GUILD_ID);
}

async function getTextChannel(guild, channelId) {
  const ch = await guild.channels.fetch(channelId);

  if (
    !ch ||
    (ch.type !== ChannelType.GuildText && ch.type !== ChannelType.GuildAnnouncement)
  ) {
    throw new Error(`Channel ${channelId} bukan text/announcement channel.`);
  }

  return ch;
}

async function refreshPanelMessage(client) {
  const guild = await getGuild(client);
  const channel = await getTextChannel(guild, DAFTAR_CHANNEL_ID);

  const embed = buildPanelEmbed();
  const components = buildPanelComponents();

  let msg = null;

  if (db.panelMessageId) {
    msg = await channel.messages.fetch(db.panelMessageId).catch(() => null);
  }

  if (!msg) {
    const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    msg = recent?.find(
      (m) =>
        m.author.id === client.user.id &&
        m.embeds?.[0]?.title?.includes("UNDERCOVER FASHION SHOW")
    );
  }

  if (msg) {
    await msg.edit({
      content: "@everyone",
      embeds: [embed],
      components,
      allowedMentions: { parse: ["everyone"] },
    });

    db.panelMessageId = msg.id;
  } else {
    const sent = await channel.send({
      content: "@everyone",
      embeds: [embed],
      components,
      allowedMentions: { parse: ["everyone"] },
    });

    db.panelMessageId = sent.id;
  }

  saveDb();
}

async function refreshParticipantList(client, options = {}) {
  const { pingEveryone = false, mentionUserId = null } = options;

  const guild = await getGuild(client);
  const channel = await getTextChannel(guild, PESERTA_CHANNEL_ID);

  const embed = buildListEmbed();

  let oldMsg = null;

  if (db.listMessageId) {
    oldMsg = await channel.messages.fetch(db.listMessageId).catch(() => null);
  }

  const contentParts = [];

  if (pingEveryone) contentParts.push("@everyone");
  if (mentionUserId) contentParts.push(`<@${mentionUserId}>`);

  const sent = await channel.send({
    content: contentParts.join(" ") || null,
    embeds: [embed],
    allowedMentions: {
      parse: pingEveryone ? ["everyone"] : [],
      users: mentionUserId ? [mentionUserId] : [],
    },
  });

  if (oldMsg && oldMsg.id !== sent.id) {
    await oldMsg.delete().catch(() => {});
  }

  db.listMessageId = sent.id;
  saveDb();
}

async function refreshAllMessages(client, options = {}) {
  await refreshPanelMessage(client);
  await refreshParticipantList(client, options);
}

function findParticipantByTarget(target) {
  const raw = String(target || "").trim();
  const mentionId = raw.match(/^<@!?(\d+)>$/)?.[1];
  const clean = cleanUsername(raw);

  return db.participants.findIndex((p) => {
    return (
      p.discordUserId === raw ||
      p.discordUserId === mentionId ||
      p.robloxUsername.toLowerCase() === clean.toLowerCase()
    );
  });
}

function isDuplicateRegistration(discordUserId, robloxUsername) {
  const rbx = cleanUsername(robloxUsername).toLowerCase();

  return db.participants.find((p) => {
    return (
      p.discordUserId === discordUserId ||
      p.robloxUsername.toLowerCase() === rbx
    );
  });
}

// ================= CLIENT =================
loadDb();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    const guild = await getGuild(client);

    await guild.commands.set([
      new SlashCommandBuilder()
        .setName("delete")
        .setDescription("Owner: hapus peserta fashion show dari list")
        .addStringOption((option) =>
          option
            .setName("peserta")
            .setDescription("Akun Discord / mention Discord / Username Roblox")
            .setRequired(true)
        )
        .toJSON(),

      new SlashCommandBuilder()
        .setName("setkuota")
        .setDescription("Owner: ubah kuota maksimal peserta fashion show")
        .addIntegerOption((option) =>
          option
            .setName("jumlah")
            .setDescription("Jumlah kuota baru")
            .setRequired(true)
            .setMinValue(1)
        )
        .toJSON(),
    ]);

    console.log("Slash commands /delete and /setkuota registered.");

    await refreshAllMessages(client, { pingEveryone: false });
  } catch (e) {
    console.error("Ready error:", e);
  }
});

client.on("interactionCreate", async (i) => {
  try {
    // ================= SLASH COMMAND: DELETE =================
    if (i.isChatInputCommand() && i.commandName === "delete") {
      const member = await i.guild.members.fetch(i.user.id).catch(() => null);

      if (!isOwner(member)) {
        return i.reply({
          content: "Command ini khusus owner.",
          ephemeral: true,
        });
      }

      if (i.channelId !== PESERTA_CHANNEL_ID) {
        return i.reply({
          content: `Command ini hanya boleh dipakai di <#${PESERTA_CHANNEL_ID}>.`,
          ephemeral: true,
        });
      }

      const target = i.options.getString("peserta", true);
      const idx = findParticipantByTarget(target);

      if (idx === -1) {
        return i.reply({
          content:
            "Peserta tidak ditemukan. Pakai mention Discord, ID Discord, atau Username Roblox.",
          ephemeral: true,
        });
      }

      const removed = db.participants.splice(idx, 1)[0];
      saveDb();

      await refreshAllMessages(client, { pingEveryone: false });

      return i.reply({
        content:
          `✅ Peserta berhasil dihapus dari list:\n` +
          `Discord: <@${removed.discordUserId}>\n` +
          `Roblox: \`${removed.robloxUsername}\`\n\n` +
          `Kuota sekarang: **${getUsedQuota()}/${db.quota}**`,
        ephemeral: true,
      });
    }

    // ================= SLASH COMMAND: SETKUOTA =================
    if (i.isChatInputCommand() && i.commandName === "setkuota") {
      const member = await i.guild.members.fetch(i.user.id).catch(() => null);

      if (!isOwner(member)) {
        return i.reply({
          content: "Command ini khusus owner.",
          ephemeral: true,
        });
      }

      const jumlah = i.options.getInteger("jumlah", true);
      const used = getUsedQuota();

      if (!Number.isFinite(jumlah) || jumlah < 1) {
        return i.reply({
          content: "Jumlah kuota tidak valid.",
          ephemeral: true,
        });
      }

      if (jumlah < used) {
        return i.reply({
          content:
            `❌ Kuota tidak bisa diset ke **${jumlah}** karena peserta terdaftar sudah **${used}**.\n` +
            `Hapus peserta dulu atau set kuota minimal **${used}**.`,
          ephemeral: true,
        });
      }

      const oldQuota = db.quota;
      db.quota = jumlah;
      saveDb();

      await refreshAllMessages(client, { pingEveryone: false });

      return i.reply({
        content:
          `✅ Kuota berhasil diubah dari **${oldQuota}** menjadi **${db.quota}**.\n` +
          `Status sekarang: **${getUsedQuota()}/${db.quota}** peserta.`,
        ephemeral: true,
      });
    }

    // ================= OPEN MODAL =================
    if (i.isButton() && i.customId === "fs_open_register_modal") {
      if (isQuotaFull()) {
        await refreshPanelMessage(client).catch(() => {});

        return i.reply({
          content:
            `⛔ Kuota sudah penuh.\n` +
            `Status: **${getUsedQuota()}/${db.quota}** peserta terdaftar.`,
          ephemeral: true,
        });
      }

      return i.showModal(buildRegisterModal());
    }

    if (i.isButton() && i.customId === "fs_retry_register_modal") {
      if (isQuotaFull()) {
        await refreshPanelMessage(client).catch(() => {});

        return i.reply({
          content:
            `⛔ Kuota sudah penuh.\n` +
            `Status: **${getUsedQuota()}/${db.quota}** peserta terdaftar.`,
          ephemeral: true,
        });
      }

      return i.showModal(buildRegisterModal());
    }

    // ================= MODAL SUBMIT =================
    if (i.isModalSubmit() && i.customId === "fs_register_modal_submit") {
      await i.deferReply({ ephemeral: true });

      if (isQuotaFull()) {
        await refreshPanelMessage(client).catch(() => {});

        return i.editReply({
          content:
            `⛔ Pendaftaran gagal karena kuota sudah penuh.\n` +
            `Status: **${getUsedQuota()}/${db.quota}** peserta terdaftar.`,
        });
      }

      const robloxUsername = cleanUsername(
        i.fields.getTextInputValue("roblox_username")
      );

      const tiktokUsername = cleanUsername(
        i.fields.getTextInputValue("tiktok_username")
      );

      if (!robloxUsername) {
        return i.editReply({
          content: "Username Roblox wajib diisi.",
          components: buildRetryButton(),
        });
      }

      if (!/^[A-Za-z0-9_]{3,20}$/.test(robloxUsername)) {
        return i.editReply({
          content:
            "Username Roblox tidak valid. Gunakan username asli Roblox tanpa @, 3-20 karakter, huruf/angka/underscore.",
          components: buildRetryButton(),
        });
      }

      if (tiktokUsername && !/^[A-Za-z0-9._]{2,30}$/.test(tiktokUsername)) {
        return i.editReply({
          content:
            "Username TikTok tidak valid. Isi tanpa @. Gunakan huruf, angka, titik, atau underscore.",
          components: buildRetryButton(),
        });
      }

      const duplicate = isDuplicateRegistration(i.user.id, robloxUsername);

      if (duplicate) {
        return i.editReply({
          content:
            `Kamu atau username Roblox ini sudah terdaftar.\n` +
            `Discord: <@${duplicate.discordUserId}>\n` +
            `Roblox: \`${duplicate.robloxUsername}\``,
        });
      }

      let roblox;

      try {
        roblox = await getRobloxUser(robloxUsername);
      } catch (e) {
        console.error("Roblox check error:", e);

        return i.editReply({
          content:
            "Gagal cek username Roblox dari API. Coba lagi beberapa saat.",
          components: buildRetryButton(),
        });
      }

      if (!roblox) {
        return i.editReply({
          content:
            `Username Roblox \`${robloxUsername}\` tidak ditemukan. Silakan isi ulang.`,
          components: buildRetryButton(),
        });
      }

      const tiktok = tiktokUsername ? buildTikTokUser(tiktokUsername) : null;

      const confirmId = crypto.randomBytes(8).toString("hex");

      const data = {
        confirmId,
        discordUserId: i.user.id,
        discordTag: i.user.tag,
        roblox,
        tiktok,
        createdAt: nowIso(),
      };

      pendingConfirmations.set(confirmId, data);

      await i.editReply({
        content:
          "✅ Data ditemukan. Bot mengirim pesan konfirmasi di channel ini.",
      });

      return i.channel.send({
        content: `<@${i.user.id}> konfirmasi akun kamu di bawah ini.`,
        embeds: [buildConfirmationEmbed(data)],
        components: buildConfirmationButtons(confirmId),
        allowedMentions: { users: [i.user.id] },
      });
    }

    // ================= CONFIRMATION BUTTONS =================
    if (i.isButton() && i.customId.startsWith("fs_confirm_")) {
      const [action, confirmId] = i.customId.split(":");
      const data = pendingConfirmations.get(confirmId);

      if (!data) {
        return i.reply({
          content:
            "Data konfirmasi sudah expired / tidak ditemukan. Silakan daftar ulang.",
          ephemeral: true,
        });
      }

      if (i.user.id !== data.discordUserId) {
        return i.reply({
          content: "Tombol ini hanya bisa diklik oleh user yang mendaftar.",
          ephemeral: true,
        });
      }

      if (action === "fs_confirm_no") {
        pendingConfirmations.delete(confirmId);

        await i.message.delete().catch(() => {});

        if (isQuotaFull()) {
          await refreshPanelMessage(client).catch(() => {});

          return i.reply({
            content:
              `⛔ Kuota sudah penuh.\n` +
              `Status: **${getUsedQuota()}/${db.quota}** peserta terdaftar.`,
            ephemeral: true,
          });
        }

        return i.showModal(buildRegisterModal());
      }

      if (action === "fs_confirm_yes") {
        await i.deferReply({ ephemeral: true });

        if (isQuotaFull()) {
          pendingConfirmations.delete(confirmId);

          await i.message.delete().catch(() => {});
          await refreshPanelMessage(client).catch(() => {});

          return i.editReply({
            content:
              `⛔ Pendaftaran gagal karena kuota sudah penuh.\n` +
              `Status: **${getUsedQuota()}/${db.quota}** peserta terdaftar.`,
          });
        }

        const duplicate = isDuplicateRegistration(
          data.discordUserId,
          data.roblox.username
        );

        if (duplicate) {
          pendingConfirmations.delete(confirmId);

          await i.message.delete().catch(() => {});

          return i.editReply({
            content:
              "Pendaftaran gagal karena akun Discord atau username Roblox ini sudah terdaftar.",
          });
        }

        const participant = {
          discordUserId: data.discordUserId,
          discordTag: data.discordTag,
          robloxUserId: data.roblox.id,
          robloxUsername: data.roblox.username,
          robloxDisplayName: data.roblox.displayName,
          robloxProfileUrl: data.roblox.profileUrl,
          robloxAvatarUrl: data.roblox.avatarUrl,
          tiktokUsername: data.tiktok?.username || "",
          tiktokProfileUrl: data.tiktok?.profileUrl || "",
          registeredAt: nowIso(),
        };

        db.participants.push(participant);
        saveDb();

        pendingConfirmations.delete(confirmId);

        await i.message.delete().catch(() => {});

        await refreshAllMessages(client, {
          pingEveryone: true,
          mentionUserId: data.discordUserId,
        });

        return i.editReply({
          content:
            `✅ Pendaftaran berhasil!\n` +
            `Roblox: \`${participant.robloxUsername}\`\n` +
            `TikTok: \`${participant.tiktokUsername || "-"}\`\n` +
            `Status kuota: **${getUsedQuota()}/${db.quota}**\n` +
            `List peserta sudah diupdate di <#${PESERTA_CHANNEL_ID}>.`,
        });
      }
    }
  } catch (e) {
    console.error("interaction error:", e);

    if (i.deferred || i.replied) {
      return i
        .followUp({
          content: "Terjadi error. Coba lagi.",
          ephemeral: true,
        })
        .catch(() => {});
    }

    return i
      .reply({
        content: "Terjadi error. Coba lagi.",
        ephemeral: true,
      })
      .catch(() => {});
  }
});

client.login(DISCORD_TOKEN);