```javascript
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

const VINTED_CHANNEL_ID = process.env.VINTED_CHANNEL_ID;
const VINTED_API = 'https://www.vinted.fr/api/v2/catalog/items';
const DEFAULT_BRANDS = ['Nike', 'Air Jordan', 'The North Face', 'Supreme', 'Adidas'];

let postedListings = new Set();

async function searchVinted(brand) {
  try {
    const response = await axios.get(VINTED_API, {
      params: {
        search_text: brand,
        order: 'newest_first',
        per_page: 30,
      },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 10000,
    });
    return response.data.items || [];
  } catch (error) {
    console.error(`Erreur Vinted pour ${brand}:`, error.message);
    return [];
  }
}

function createListingEmbed(item) {
  const embed = new EmbedBuilder()
    .setTitle(`${item.title || 'Sans titre'}`)
    .setURL(`https://www.vinted.fr/items/${item.id}`)
    .setColor('#00B4D8')
    .addFields(
      { name: '💰 Prix', value: `${item.price}€`, inline: true },
      { name: '📍 Localisation', value: item.user?.city || 'Non spécifié', inline: true },
      { name: '⭐ Vendeur', value: `${item.user?.login || 'Anonyme'}`, inline: false },
      { name: '📝 Description', value: item.description?.substring(0, 100) || 'N/A', inline: false }
    )
    .setFooter({ text: `ID: ${item.id}` })
    .setTimestamp();
  
  if (item.photo?.image?.medium_url) {
    embed.setImage(item.photo.image.medium_url);
  }
  return embed;
}

async function findAndPost(brand, message) {
  const items = await searchVinted(brand);

  if (items.length === 0) {
    return await message.reply(`❌ Aucune annonce trouvée pour "${brand}".`);
  }

  const filteredItems = items.filter(item => !postedListings.has(item.id));

  if (filteredItems.length === 0) {
    return await message.reply(`✅ Aucune nouvelle annonce pour "${brand}".`);
  }

  for (const item of filteredItems.slice(0, 5)) {
    const embed = createListingEmbed(item);
    await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } });
    postedListings.add(item.id);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

client.once('ready', () => {
  console.log(`✅ Bot connecté: ${client.user.tag}`);
  client.user.setActivity('!vinted help', { type: 'LISTENING' });

  setInterval(async () => {
    const channel = client.channels.cache.get(VINTED_CHANNEL_ID);
    if (channel) {
      for (const brand of DEFAULT_BRANDS) {
        await findAndPost(brand, { reply: async (opts) => channel.send(opts) });
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }, 3600000);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('!vinted')) return;

  try {
    const args = message.content.slice(7).trim().split(/ +/);
    const command = args[0]?.toLowerCase();

    if (command === 'find') {
      const brand = args.slice(1).join(' ') || 'Nike';
      await message.reply(`🔍 Recherche "${brand}"...`);
      await findAndPost(brand, message);
    } else if (command === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setTitle('🛍️ Vinqor - Aide')
        .setColor('#00B4D8')
        .addFields(
          { name: '!vinted find [marque]', value: 'Cherche des annonces Vinted', inline: false },
          { name: '!vinted help', value: 'Affiche cette aide', inline: false }
        );
      await message.reply({ embeds: [helpEmbed], allowedMentions: { repliedUser: false } });
    }
  } catch (error) {
    console.error('Erreur:', error.message);
    await message.reply(`❌ Erreur: ${error.message}`).catch(() => {});
  }
});

client.login(process.env.DISCORD_TOKEN);
```