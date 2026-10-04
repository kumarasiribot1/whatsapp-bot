const { default: makeWASocket, useMultiFileAuthState, Browsers, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');

// බොට්ගේ හිමිකරුගේ විස්තර (මෙම අංකයට සහ නමට ඔවර්නර් බලතල හිමිවේ)
const OWNER_NUMBER = "94784422746"; 
const OWNER_NAME = "Mr. Dilshan Kumarasiri";

// ---------------------------------------------------------
// බොට් එක ක්‍රියාත්මක වන ප්‍රධාන Function එක
// ---------------------------------------------------------
async function startBot(sessionName, phoneNumber) {
    const { state, saveCreds } = await useMultiFileAuthState(sessionName);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.ubuntu('Chrome')
    });

    // Pairing Code ලබාගැනීම (පළමු වතාවට අංකය සම්බන්ධ කරන විට පමණක් Pairing Code එක ලබා දෙයි)
    if (!sock.authState.creds.registered && phoneNumber) {
        setTimeout(async () => {
            try {
                const code = await sock.requestPairingCode(phoneNumber.trim());
                console.log(`\n=================================\n[ ${sessionName} ] Pairing Code: ${code}\n=================================\n`);
            } catch (err) {
                console.log(`[ ${sessionName} ] Error getting pairing code:`, err);
            }
        }, 3000);
    }

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const senderJid = msg.key.remoteJid;
        const isGroup = senderJid.endsWith('@g.us');
        const sender = msg.key.participant || msg.key.remoteJid;

        const messageContent = msg.message.conversation || 
                               msg.message.extendedTextMessage?.text || '';

        if (!isGroup || !messageContent) return;

        const senderNumberOnly = sender.split('@')[0];
        const isOwner = senderNumberOnly === OWNER_NUMBER;

        const getGroupAdmins = async (participants) => {
            return participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin').map(p => p.id);
        };

        let groupMetadata;
        let groupAdmins = [];
        try {
            groupMetadata = await sock.groupMetadata(senderJid);
            groupAdmins = await getGroupAdmins(groupMetadata.participants);
        } catch (err) {
            console.log("Error getting group metadata:", err);
        }

        const isAdmin = groupAdmins.includes(sender);

        // ---------------------------------------------------------
        // 🔴 ANTI-LINK FEATURE (ගෘප් සහ චැනල් ලින්ක් මැකීම)
        // ---------------------------------------------------------
        const linkRegex = /(chat\.whatsapp\.com\/[a-zA-Z0-9]|whatsapp\.com\/channel\/[a-zA-Z0-9]|wa\.me\/)/i;
        
        if (linkRegex.test(messageContent)) {
            if (isOwner || isAdmin) return; 

            try {
                await sock.sendMessage(senderJid, { delete: msg.key });
                await sock.sendMessage(senderJid, { 
                    text: `⚠️ @${senderNumberOnly} මෙම සමූහයට WhatsApp Group හෝ Channel Links දැමීම තහනම්! ඔබේ මැසේජ් එක ඉවත් කරන ලදී.`,
                    mentions: [sender]
                });
                return;
            } catch (err) {
                console.log("Anti-link delete error:", err);
            }
        }

        const command = messageContent.trim().toLowerCase();

        if (command === '.owner' || command === 'owner') {
            const ownerInfo = `👑 *BOT OWNER INFO* 👑\n\n👤 නම: ${OWNER_NAME}\n📞 අංකය: +${OWNER_NUMBER}`;
            await sock.sendMessage(senderJid, { text: ownerInfo }, { quoted: msg });
            return;
        }

        if (command.startsWith('.')) {
            if (!isAdmin) {
                await sock.sendMessage(senderJid, { text: `⚠️ මෙම කමාන්ඩ් භාවිතා කළ හැක්කේ සමූහයේ ඇඩ්මින්වරුන්ට (Admins) පමණි!` }, { quoted: msg });
                return;
            }
        }

        // 1. .tagall
        if (command === '.tagall') {
            try {
                const participants = groupMetadata.participants;
                let text = `📢 *ATTENTION ALL MEMBERS* 📢\n\n`;
                for (let mem of participants) {
                    text += `‎@${mem.id.split('@')[0]}\n`;
                }
                await sock.sendMessage(senderJid, { text: text, mentions: participants.map(a => a.id) }, { quoted: msg });
            } catch (err) {
                console.error(err);
            }
        }

        // 2. .kick
        else if (command === '.kick') {
            const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.participant;
            if (!quotedMsg) {
                await sock.sendMessage(senderJid, { text: `⚠️ කරුණාකර ඉවත් කළ යුතු සාමාජිකයාගේ පණිවිඩයට රිප්ලයි කර .kick ලෙස යවන්න.` }, { quoted: msg });
                return;
            }
            try {
                await sock.groupParticipantsUpdate(senderJid, [quotedMsg], "remove");
                await sock.sendMessage(senderJid, { text: `🚫 සාර්ථකව ගෘප් එකෙන් ඉවත් කරන ලදී.` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(senderJid, { text: `⚠ බොට් සතුව ඇමින් බලතල තිබිය යුතුය.` }, { quoted: msg });
            }
        }

        // 3. .promote
        else if (command === '.promote') {
            const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.participant;
            if (!quotedMsg) return;
            try {
                await sock.groupParticipantsUpdate(senderJid, [quotedMsg], "promote");
                await sock.sendMessage(senderJid, { text: `⭐ සාමාජිකයාට ඇමින් බලතල ලබා දෙන ලදී.` }, { quoted: msg });
            } catch (err) {
                console.error(err);
            }
        }

        // 4. .demote
        else if (command === '.demote') {
            const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.participant;
            if (!quotedMsg) return;
            try {
                await sock.groupParticipantsUpdate(senderJid, [quotedMsg], "demote");
                await sock.sendMessage(senderJid, { text: `📉 ඇමින් බලතල ඉවත් කරන ලදී.` }, { quoted: msg });
            } catch (err) {
                console.error(err);
            }
        }

        // 5. .grouplink
        else if (command === '.grouplink') {
            try {
                const code = await sock.groupInviteCode(senderJid);
                await sock.sendMessage(senderJid, { text: `🔗 ගෘප් ලින්ක් එක:\nhttps://chat.whatsapp.com/${code}` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(senderJid, { text: `⚠ බොට් ඇමින් කෙනෙක් විය යුතුය.` }, { quoted: msg });
            }
        }

        // 6. .ginfo
        else if (command === '.ginfo') {
            try {
                const metadata = await sock.groupMetadata(senderJid);
                const infoText = `📊 *GROUP INFORMATION*\n\n` +
                                 `📌 නම: ${metadata.subject}\n` +
                                 `👥 සාමාජිකයන් ගණන: ${metadata.participants.length}`;
                await sock.sendMessage(senderJid, { text: infoText }, { quoted: msg });
            } catch (err) {
                console.error(err);
            }
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log(`[ ${sessionName} ] WhatsApp Bot connected successfully!`);
        } else if (connection === 'close') {
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) {
                startBot(sessionName, phoneNumber); 
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// ---------------------------------------------------------
// 🚀 බොට් අංක 10 දක්වා එකතු කළ හැකි ස්ථානය
// ---------------------------------------------------------
// අවශ්‍ය අංකවලට අදාළව පහත පේළිවලින් (`//` ලකුණ ඉවත් කර) අංක එකතු කරන්න / ඉවත් කරන්න:

startBot('session_1', '94784422746'); // පළමු අංකය
// startBot('session_2', '947xxxxxxxx'); // දෙවන අංකය
// startBot('session_3', '947xxxxxxxx'); // තුන්වන අංකය
// startBot('session_4', '947xxxxxxxx'); // හතරවන අංකය
// startBot('session_5', '947xxxxxxxx'); // පස්වන අංකය
// startBot('session_6', '947xxxxxxxx'); // හයවන අංකය
// startBot('session_7', '947xxxxxxxx'); // සත්වන අංකය
// startBot('session_8', '947xxxxxxxx'); // අටවන අංකය
// startBot('session_9', '947xxxxxxxx'); // නවවන අංකය
// startBot('session_10', '947xxxxxxxx'); // දශමවන අංකය