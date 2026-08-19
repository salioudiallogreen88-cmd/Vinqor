javascript
import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import axios from 'axios';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const VINTED_CHANNEL_ID = process.env.VINTED_CHANNEL_ID;
const DEFAULT_BRANDS = (process.env.DEFAULT_BRANDS || 'Nike,Adidas').split(',').map(b => b.trim());
const AUTO_SEARCH_INTERVAL = parseInt(process.env.AUTO_SEARCH_INTERVAL || '3600') * 1000;

let autoSearchActive = false;
let autoSearchInterval = null;
const lastSearchCache = new Map();

async function searchVinted(brand, page = 0) {
  try {
    const perPage = 30;
    const offset = page * perPage;
    const url = `https://www.vinted.fr/api/v2/catalog/items?search_text=${encodeURIComponent(brand)}&status_ids=6&per_page=${perPage}&offset=${offset}`;
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 10000,
    });

    return response.data.items || [];
  } catch (error) {
    console.error(`Vinted search error for "${brand}":`, error.message);
    throw new Error(`Failed to search Vinted for "${brand}".`);
  }
}

function createListingEmbed(item, index, total) {
  const embed = new EmbedBuilder()
    .setColor('#2DD4BF')
    .setTitle(item.title?.substring(0, 256) || 'Listing')
    .setDescription(`**Price:** €${item.price_cents / 100}\n**Seller:** ${item.user?.login || 'Unknown'}\n**Condition:** ${item.status || 'Unknown'}`)
    .setFooter({ text: `Result ${index + 1} of ${total}` });

  if (item.photos?.length > 0 && item.photos[0].image?.path_key) {
    embed.setImage(`https://images1-focus-opensooq-com.akamaized.net/unsafe/400x300/center/${item.photos[0].image.path_key}`);
  }

  if (item.url) {
    embed.setURL(`https://www.vinted.fr${item.url}`);
  }

  return embed;
}

client.on('ready', () => {
  console.log(`✅ Bot logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith('!vinted')) return;

  const args = message.content.slice(7).trim().split(' ');
  const command = args[0];

  try {
    if (command === 'find') {
      const brand = args.slice(1).join(' ').trim();
      if (!brand) {
        return message.reply('Usage: `!vinted find [brand]`');
      }

      await message.reply(`🔍 Searching Vinted for **${brand}**...`);

      const listings = await searchVinted(brand, 0);
      if (listings.length === 0) {
        return message.reply(`❌ No listings found for **${brand}**.`);
      }

      lastSearchCache.set(message.author.id, { listings, brand, page: 0 });

      const embed = createListingEmbed(listings[0], 0, listings.length);
      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`vinted_prev_${message.author.id}`)
          .setLabel('← Previous')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`vinted_next_${message.author.id}`)
          .setLabel('Next →')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(listings.length <= 1)
      );

      await message.reply({ embeds: [embed], components: [buttons] });
    } else if (command === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setColor('#2DD4BF')
        .setTitle('Vinqor - Vinted Search Bot')
        .setDescription('Search Vinted listings directly from Discord!')
        .addFields(
          { name: '!vinted find [brand]', value: 'Search for listings by brand' },
          { name: '!vinted help', value: 'Show this help message' },
          { name: '!vinted auto-toggle', value: 'Toggle automatic hourly searches' }
        );

      await message.reply({ embeds: [helpEmbed] });
    } else if (command === 'auto-toggle') {
      autoSearchActive = !autoSearchActive;

      if (autoSearchActive) {
        const channel = client.channels.cache.get(VINTED_CHANNEL_ID);
        if (!channel) {
          return message.reply('❌ Auto-search channel not found. Check VINTED_CHANNEL_ID.');
        }

        autoSearchInterval = setInterval(async () => {
          for (const brand of DEFAULT_BRANDS) {
            try {
              const listings = await searchVinted(brand, 0);
              if (listings.length > 0 && listings[0].id !== lastSearchCache.get(`auto_${brand}`)) {
                lastSearchCache.set(`auto_${brand}`, listings[0].id);
                const embed = createListingEmbed(listings[0], 0, listings.length);
                await channel.send({ content: `🔍 **Auto-search: ${brand}**`, embeds: [embed] });
              }
            } catch (err) {
              console.error(`Auto-search failed for ${brand}:`, err);
            }
          }
        }, AUTO_SEARCH_INTERVAL);

        await message.reply(`✅ Auto-search **enabled** for: ${DEFAULT_BRANDS.join(', ')}`);
      } else {
        if (autoSearchInterval) clearInterval(autoSearchInterval);
        await message.reply('❌ Auto-search **disabled**.');
      }
    } else {
      await message.reply('Unknown command. Use `!vinted help` for available commands.');
    }
  } catch (error) {
    console.error('Command error:', error);
    await message.reply(`❌ Error: ${error.message}`);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const [action, userId] = interaction.customId.split('_').slice(1);
  if (userId !== interaction.user.id) {
    return interaction.reply({ content: '❌ This button is not for you.', ephemeral: true });
  }

  const search = lastSearchCache.get(userId);
  if (!search) {
    return interaction.reply({ content: '❌ Search expired. Please search again.', ephemeral: true });
  }

  if (action === 'prev') {
    search.page = Math.max(0, search.page - 1);
  } else if (action === 'next') {
    search.page = Math.min(Math.floor(search.listings.length / 10), search.page + 1);
  }

  const item = search.listings[search.page];
  const embed = createListingEmbed(item, search.page, search.listings.length);
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`vinted_prev_${userId}`)
      .setLabel('← Previous')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(search.page === 0),
    new ButtonBuilder()
      .setCustomId(`vinted_next_${userId}`)
      .setLabel('Next →')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(search.page >= search.listings.length - 1)
  );

  await interaction.update({ embeds: [embed], components: [buttons] });
});

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

client.login(DISCORD_TOKEN);