const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const VINTED_API_BASE = 'https://www.vinted.fr/api/v2';
const VINTED_BASE_URL = 'https://www.vinted.fr';
const POSTED_LISTINGS = new Set();
let autoSearchInterval;

client.on('ready', () => {
  console.log(`✅ Bot connecté: ${client.user.tag}`);
  startAutoSearch();
});

client.on('messageCreate', async (message) => {
  if (!message.content.startsWith('!vinted')) return;

  const args = message.content.slice(7).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  if (command === 'find') {
    const query = args.join(' ');
    if (!query) {
      return message.reply('❌ Utilise: `!vinted find <marque ou objet>`');
    }
    await searchAndDisplay(message, query, 0);
  } else if (command === 'help') {
    const helpEmbed = new EmbedBuilder()
      .setColor('#FF6B35')
      .setTitle('📚 Aide - Vinted Bot')
      .addFields(
        { name: '!vinted find <recherche>', value: 'Cherche des annonces Vinted' },
        { name: '!vinted help', value: 'Affiche cette aide' }
      );
    message.reply({ embeds: [helpEmbed] });
  }
});

async function fetchVintedListings(query, limit = 10) {
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };

    const params = {
      search_text: query,
      status_ids: '2',
      size: limit,
      catalog_ids: '0'
    };

    const response = await axios.get(`${VINTED_API_BASE}/catalog/items`, { params, headers, timeout: 10000 });
    
    if (!response.data.items) return [];

    return response.data.items.map(item => ({
      id: item.id,
      title: item.title,
      brand: item.brand_title || 'Non spécifié',
      price: item.price_numeric,
      currency: item.currency,
      status: item.status || 'Disponible',
      photo: item.photo ? `https://img.vinted.net/${item.photo.image.split('/').pop()}` : null,
      url: `${VINTED_BASE_URL}/items/${item.id}`,
      condition: item.status_title || 'N/A',
      location: item.user?.city || 'Non spécifié'
    })).sort((a, b) => a.price - b.price);
  } catch (error) {
    console.error('❌ Erreur lors de la recherche Vinted:', error.message);
    return [];
  }
}

async function searchAndDisplay(message, query, page = 0) {
  try {
    await message.deferReply();
    
    const listings = await fetchVintedListings(query, 100);
    
    if (listings.length === 0) {
      return message.editReply('❌ Aucune annonce trouvée pour cette recherche.');
    }

    const itemsPerPage = 10;
    const totalPages = Math.ceil(listings.length / itemsPerPage);
    const currentPage = Math.min(page, totalPages - 1);
    const start = currentPage * itemsPerPage;
    const pageItems = listings.slice(start, start + itemsPerPage);

    const embeds = pageItems.map(item => {
      const embed = new EmbedBuilder()
        .setColor('#FF6B35')
        .setTitle(item.title)
        .setURL(item.url)
        .addFields(
          { name: '💰 Prix', value: `${item.price}€`, inline: true },
          { name: '🏷️ Marque', value: item.brand, inline: true },
          { name: '📍 État', value: item.condition, inline: true },
          { name: '📌 Localisation', value: item.location, inline: true }
        )
        .setFooter({ text: `Page ${currentPage + 1}/${totalPages}` });

      if (item.photo) embed.setThumbnail(item.photo);

      return embed;
    });

    const buttons = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`prev_${query}_${currentPage}`)
          .setLabel('⬅️ Précédente')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(currentPage === 0),
        new ButtonBuilder()
          .setCustomId('page_info')
          .setLabel(`Page ${currentPage + 1}/${totalPages}`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`next_${query}_${currentPage}`)
          .setLabel('Suivante ➡️')
          .setStyle(ButtonStyle.Primary)
          .setDisabled(currentPage === totalPages - 1)
      );

    message.editReply({ embeds, components: [buttons] });

    const collector = message.channel.createMessageComponentCollector({ time: 60000 });
    collector.on('collect', async interaction => {
      if (interaction.user.id !== message.author.id) {
        return interaction.reply({ content: '❌ Tu ne peux pas utiliser ces boutons.', ephemeral: true });
      }

      const [action, searchQuery, pageNum] = interaction.customId.split('_');
      let newPage = parseInt(pageNum);

      if (action === 'next') newPage++;
      if (action === 'prev') newPage--;

      await interaction.deferUpdate();
      await searchAndDisplay(message, searchQuery, newPage);
      collector.stop();
    });

  } catch (error) {
    console.error('❌ Erreur:', error);
    message.editReply('❌ Une erreur est survenue.');
  }
}

async function startAutoSearch() {
  const channelId = process.env.VINTED_CHANNEL_ID;
  if (!channelId) {
    console.log('⚠️ VINTED_CHANNEL_ID non configuré. Auto-recherche désactivée.');
    return;
  }

  autoSearchInterval = setInterval(async () => {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) return;

      const searches = ['Nike', 'Air Jordan', 'The North Face', 'Supreme', 'Adidas'];
      const randomSearch = searches[Math.floor(Math.random() * searches.length)];

      const listings = await fetchVintedListings(randomSearch, 5);
      
      for (const item of listings) {
        if (!POSTED_LISTINGS.has(item.id)) {
          const embed = new EmbedBuilder()
            .setColor('#FF6B35')
            .setTitle(item.title)
            .setURL(item.url)
            .addFields(
              { name: '💰 Prix', value: `${item.price}€`, inline: true },
              { name: '🏷️ Marque', value: item.brand, inline: true }
            );

          if (item.photo) embed.setThumbnail(item.photo);

          await channel.send({ embeds: [embed] });
          POSTED_LISTINGS.add(item.id);

          if (POSTED_LISTINGS.size > 1000) {
            const first = POSTED_LISTINGS.values().next().value;
            POSTED_LISTINGS.delete(first);
          }
        }
      }

      console.log(`✅ Auto-recherche: ${randomSearch} - ${listings.length} annonces trouvées.`);
    } catch (error) {
      console.error('❌ Erreur auto-recherche:', error.message);
    }
  }, 3600000);
}

client.login(process.env.DISCORD_TOKEN);