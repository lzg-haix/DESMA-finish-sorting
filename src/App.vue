<script setup>
// NO CHANGES TO SCRIPT. Provided for completeness.
import { ref, onMounted, nextTick } from 'vue';
import { PAS } from '@/utils/pas-util';

if (!PAS) { console.error('oepas_dev2 instanca nije dostupna.'); }

const currentPosition = ref(1);
const rasterItems = ref([]);
const isLoading = ref(false);
const barcodeValue = ref('');
const barcodeInput = ref(null);
const userMessage = ref({ text: '', type: 'info' });
let messageTimeout = null;
const lastPlacedBinId = ref(null);
const PROCESSED_BARCODES_STORAGE_KEY = 'finsort-processed-barcodes';
const processedBarcodes = ref(new Set());

const setMessage = (text, type = 'info', duration = 4000) => {
  userMessage.value = { text, type };
  clearTimeout(messageTimeout);
  if (duration > 0) {
    messageTimeout = setTimeout(() => { userMessage.value = { text: '', type: 'info' }; }, duration);
  }
};

const getPositionData = async () => {
  isLoading.value = true;
  try {
    const filter = encodeURI(`?filter=BrPoz=${currentPosition.value}`);
    const response = await PAS.get(`/FinSortD${filter}`);
    const data = response.data?.dsFinSortD?.ttFinSortD || [];
    rasterItems.value = data
      .sort((a, b) => a.BrPolja - b.BrPolja)
      .map(item => ({
        id: `${currentPosition.value}-${item.BrPolja}`,
        ...item,
      }));
  } catch (error) {
    console.error('Greška pri dohvaćanju podataka:', error);
    setMessage(`Greška pri dohvaćanju podataka: ${error.message}`, 'error', 5000);
  } finally {
    isLoading.value = false;
  }
};

const getBarColor = (capacity) => {
  if (capacity <= 0) return '#ccc';
  const colors = ['#ff4d4d', '#ff944d', '#ffd633', '#a6e22e', '#4caf50'];
  return colors[Math.min(capacity, 5) - 1];
};

const clearLastPlacedGlow = () => {
  lastPlacedBinId.value = null;
};

const clearProcessedBarcodes = () => {
  clearLastPlacedGlow();
  if (confirm('Jeste li sigurni da želite obrisati povijest skeniranih barkodova za ovu sesiju?')) {
    processedBarcodes.value.clear();
    localStorage.removeItem(PROCESSED_BARCODES_STORAGE_KEY);
    setMessage('Povijest skeniranja je obrisana.', 'info');
  }
};

const emptyAllBins = async () => {
  clearLastPlacedGlow();
  if (confirm('JESTE LI SIGURNI? Ova akcija će isprazniti SVE kutije na ovoj poziciji i resetirati sesiju!')) {
    isLoading.value = true;
    setMessage('Pražnjenje pozicije...', 'info', 0);
    try {
      await PAS.put('/FinSortD/EmptyPosition', { iBrPoz: currentPosition.value });
      await getPositionData();
      clearProcessedBarcodes();
      setMessage('Sve kutije na poziciji su ispražnjene.', 'success');
    } catch (error) {
      console.error('Greška pri pražnjenju pozicije:', error);
      setMessage(`Greška pri pražnjenju: ${error.message}`, 'error');
    } finally {
      isLoading.value = false;
    }
  }
};

const emptyFullBin = async (binItem) => {
  if (confirm(`Jeste li sigurni da želite isprazniti punu kutiju ${binItem.BrPolja} i zabilježiti gotovu količinu?`)) {
    isLoading.value = true;
    setMessage(`Praznim kutiju ${binItem.BrPolja}...`, 'info', 0);
    try {
      const payload = {
        ttPayload: [{ BrPoz: binItem.BrPolja, BrPolja: binItem.BrPolja }]
      };
      await PAS.post('/FinSortR', payload);
      setMessage(`Kutija ${binItem.BrPolja} je uspješno ispražnjena.`, 'success');
      await getPositionData();
    } catch (error) {
      console.error('Greška pri pražnjenju pune kutije:', error);
      setMessage(`Greška: ${error.response?.data?.errors?.[0]?.message || error.message}`, 'error');
    } finally {
      isLoading.value = false;
    }
  }
};

const handleContainerClick = (item) => {
  clearLastPlacedGlow();
  if (isLoading.value) return;
  if (item.Kolicina === 5) {
    emptyFullBin(item);
  }
};

const handleBarcodeScan = async () => {
  clearLastPlacedGlow();
  if (!barcodeValue.value || isLoading.value) return;
  const currentBarcode = barcodeValue.value;
  if (processedBarcodes.value.has(currentBarcode)) {
    setMessage(`Barkod [${currentBarcode}] je već obrađen.`, 'error');
    barcodeValue.value = '';
    return;
  }
  barcodeValue.value = '';
  isLoading.value = true;
  setMessage('Skeniranje...', 'info', 0);
  try {
    const response = await PAS.put('/Scanner/Barcode', { ipBarcode: currentBarcode });
    const scannedData = response.data?.response?.ttScan?.ttScan[0];
    if (!scannedData) throw new Error('Barkod nije prepoznat.');
    if (scannedData.BrPoz > 0 && scannedData.BrPoz !== currentPosition.value) {
      setMessage(`Artikl pripada poziciji ${scannedData.BrPoz}! Proslijedite kutiju.`, 'error', 5000);
      return;
    }
    let targetContainer = rasterItems.value.find(item =>
      item.SifArtik === scannedData.SifArtik &&
      item.Velicina === scannedData.Velicina &&
      item.Kolicina > 0 && item.Kolicina < 5
    );
    if (!targetContainer) {
      targetContainer = rasterItems.value.find(item => item.Kolicina === 0);
    }
    if (targetContainer) {
      await placeBox(targetContainer, scannedData, currentBarcode);
    } else {
      setMessage('Svi kontejneri su puni!', 'error', 5000);
    }
  } catch (error) {
    console.error('Greška pri obradi barkoda:', error);
    setMessage(error.message, 'error', 5000);
  } finally {
    isLoading.value = false;
  }
};

const placeBox = async (targetBin, itemData = null, originalBarcode) => {
  if (!originalBarcode) {
    console.error("placeBox pozvan bez originalnog barkoda!");
    return;
  }
  const dataForPayload = itemData || targetBin;
  const payload = { dsFinSortD: { ttFinSortD: [{ BrPoz: currentPosition.value, BrPolja: targetBin.BrPolja, SifArtik: dataForPayload.SifArtik, Velicina: dataForPayload.Velicina, BrRadNal: dataForPayload.BrRadNal, BrNar: dataForPayload.BrNar }] } };
  isLoading.value = true;
  try {
    await PAS.put('/FinSortD', payload);
    setMessage(`Artikl uspješno smješten u polje ${targetBin.BrPolja}.`, 'success');
    lastPlacedBinId.value = `${currentPosition.value}-${targetBin.BrPolja}`;
    processedBarcodes.value.add(originalBarcode);
    localStorage.setItem(PROCESSED_BARCODES_STORAGE_KEY, JSON.stringify(Array.from(processedBarcodes.value)));
    await getPositionData();
  } catch (error) {
    console.error('Greška pri ažuriranju kontejnera:', error);
    setMessage(`Greška: ${error.response?.data?.errors?.[0]?.message || error.message}`, 'error', 5000);
  } finally {
    isLoading.value = false;
  }
};

onMounted(async () => {
  const storedBarcodes = localStorage.getItem(PROCESSED_BARCODES_STORAGE_KEY);
  if (storedBarcodes) {
    try {
      processedBarcodes.value = new Set(JSON.parse(storedBarcodes));
    } catch (e) {
      processedBarcodes.value = new Set();
    }
  }
  await getPositionData();
  nextTick(() => barcodeInput.value?.focus());
});
</script>

<template>
  <div class="page-container">
    <div class="header">
      <h1 class="page-title">Sortiranje - Pozicija {{ currentPosition }}</h1>
    </div>

    <input ref="barcodeInput" class="barcode-value" v-model="barcodeValue" @keyup.enter="handleBarcodeScan"
      placeholder="Skenirajte barkod..." autocomplete="off" :disabled="isLoading"
      @blur="() => $refs.barcodeInput.focus()" />

    <div class="raster">
      <div v-for="item in rasterItems" :key="item.id" class="container" :class="{
        'full': item.Kolicina === 5,
        'last-placed': item.id === lastPlacedBinId
      }" @click="handleContainerClick(item)">
        <div class="raster-details">
          <div v-for="n in 5" :key="n" class="bar"
            :style="{ backgroundColor: n >= (6 - item.Kolicina) ? getBarColor(item.Kolicina) : '#ccc' }"></div>
        </div>
        <div class="raster-id">{{ item.BrPolja }}</div>
      </div>
    </div>

    <div class="footer-controls">
      <div class="action-buttons">
        <button @click="clearProcessedBarcodes" class="clear-button" title="Obriši povijest skeniranja">
          Nova Sesija
        </button>
        <button @click="emptyAllBins" class="empty-all-button" title="Isprazni sve kutije na poziciji">
          Isprazni Poziciju
        </button>
      </div>
      <div v-if="userMessage.text" class="user-message" :class="`message-${userMessage.type}`">
        {{ userMessage.text }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 1em;
}

.header {
  width: 100%;
  text-align: center;
}

.page-title {
  font-size: 2em;
  font-weight: bold;
  color: #2c3e50;
  margin-bottom: 0.5em;
}

.barcode-value {
  font-size: 2em;
  font-weight: bolder;
  border: 2px solid #2c3e50;
  background-color: #f8f7e7;
  margin: 0.5em 0 1.5em 0;
  padding: 0.2em 0.5em;
  border-radius: 0.3em;
  width: 100%;
  max-width: 500px;
  text-align: center;
}

.barcode-value:focus {
  outline: none;
  border-color: #2c3e50;
  box-shadow: 0 0 8px #305172;
}

.raster {
  display: grid;
  grid-template-columns: repeat(14, max-content);
  grid-template-rows: repeat(2, 1fr);
  gap: 1.25em;
  row-gap: 2em;
  ;
}

.container {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 2px solid #2c3e50;
  border-radius: 0.75em;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
  width: 7em;
  height: 10em;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s, box-shadow 0.3s, border-color 0.3s;
  background-color: #2c3e50;
  /* Match the bottom ID background color */
}

.container:hover {
  transform: translateY(-4px);
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
}

.container::before {
  content: '';
  position: absolute;
  z-index: -1;
  inset: -5px;
  border-radius: inherit;
  background: transparent;
  transition: background 0.3s;
}

.raster-details {
  flex: 3;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  padding: 0.5em 1em;
  background-color: #f8f7e7;
  gap: 0.3em;
  margin-bottom: -1px;
  /* Fix the white line gap */
  border-top-left-radius: 0.75em;
  /* Match parent's border radius exactly */
  border-top-right-radius: 0.75em;
}

.raster-id {
  flex: 1;
  padding: 0.4em;
  background-color: #2c3e50;
  color: white;
  text-align: center;
  font-weight: bold;
  font-size: 1.2em;
  margin-bottom: -1px;
  /* Fix the bottom gap */
  border-bottom-left-radius: 0.75em;
  /* Match parent's border radius exactly */
  border-bottom-right-radius: 0.75em;
  /* Remove the calc() for border radius since we're matching parent exactly */
}

.bar {
  width: 80%;
  height: 1em;
  background-color: #ccc;
  border-radius: 0.2em;
  transition: background-color 0.3s;
}

.footer-controls {
  margin-top: 1.5em;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5em;
  width: 100%;
}

.action-buttons {
  display: flex;
  gap: 1.5em;
}

.clear-button,
.empty-all-button {
  padding: 0.6em 1.2em;
  font-size: 1em;
  font-weight: bold;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.2s, transform 0.1s;
}

.clear-button:active,
.empty-all-button:active {
  transform: translateY(1px);
}

.clear-button {
  background-color: #ff9800;
}

.clear-button:hover {
  background-color: #e68900;
}

.empty-all-button {
  background-color: #f44336;
}

.empty-all-button:hover {
  background-color: #d32f2f;
}

.user-message {
  padding: 0.8em 1.8em;
  border-radius: 8px;
  color: white;
  font-size: 1.1em;
  font-weight: bold;
  min-height: 52px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.3s, opacity 0.3s;
  width: 100%;
  max-width: 700px;
  box-sizing: border-box;
}

.message-success {
  background-color: #4caf50;
}

.message-error {
  background-color: #f44336;
}

.message-info {
  background-color: #2196F3;
}

/* Replace the existing keyframe animations with these enhanced versions */
@keyframes circle-glow-full {
  0% {
    box-shadow:
      0 0 20px 8px rgba(76, 175, 80, 0.4),
      0 -15px 20px -5px rgba(76, 175, 80, 0.8);
  }

  25% {
    box-shadow:
      0 0 20px 8px rgba(76, 175, 80, 0.4),
      15px 0 20px -5px rgba(76, 175, 80, 0.8);
  }

  50% {
    box-shadow:
      0 0 20px 8px rgba(76, 175, 80, 0.4),
      0 15px 20px -5px rgba(76, 175, 80, 0.8);
  }

  75% {
    box-shadow:
      0 0 20px 8px rgba(76, 175, 80, 0.4),
      -15px 0 20px -5px rgba(76, 175, 80, 0.8);
  }

  100% {
    box-shadow:
      0 0 20px 8px rgba(76, 175, 80, 0.4),
      0 -15px 20px -5px rgba(76, 175, 80, 0.8);
  }
}

@keyframes circle-glow-last-placed {
  0% {
    box-shadow:
      0 0 20px 8px rgba(255, 193, 7, 0.4),
      0 -15px 20px -5px rgba(255, 193, 7, 0.8);
  }

  25% {
    box-shadow:
      0 0 20px 8px rgba(255, 193, 7, 0.4),
      15px 0 20px -5px rgba(255, 193, 7, 0.8);
  }

  50% {
    box-shadow:
      0 0 20px 8px rgba(255, 193, 7, 0.4),
      0 15px 20px -5px rgba(255, 193, 7, 0.8);
  }

  75% {
    box-shadow:
      0 0 20px 8px rgba(255, 193, 7, 0.4),
      -15px 0 20px -5px rgba(255, 193, 7, 0.8);
  }

  100% {
    box-shadow:
      0 0 20px 8px rgba(255, 193, 7, 0.4),
      0 -15px 20px -5px rgba(255, 193, 7, 0.8);
  }
}

@keyframes circle-glow-combined {
  0% {
    box-shadow:
      0 0 20px 8px rgba(76, 175, 80, 0.3),
      0 -15px 20px -5px rgba(76, 175, 80, 0.8),
      0 0 20px 8px rgba(255, 193, 7, 0.3),
      15px 0 20px -5px rgba(255, 193, 7, 0.8);
  }

  25% {
    box-shadow:
      0 0 20px 8px rgba(76, 175, 80, 0.3),
      15px 0 20px -5px rgba(76, 175, 80, 0.8),
      0 0 20px 8px rgba(255, 193, 7, 0.3),
      0 15px 20px -5px rgba(255, 193, 7, 0.8);
  }

  50% {
    box-shadow:
      0 0 20px 8px rgba(76, 175, 80, 0.3),
      0 15px 20px -5px rgba(76, 175, 80, 0.8),
      0 0 20px 8px rgba(255, 193, 7, 0.3),
      -15px 0 20px -5px rgba(255, 193, 7, 0.8);
  }

  75% {
    box-shadow:
      0 0 20px 8px rgba(76, 175, 80, 0.3),
      -15px 0 20px -5px rgba(76, 175, 80, 0.8),
      0 0 20px 8px rgba(255, 193, 7, 0.3),
      0 -15px 20px -5px rgba(255, 193, 7, 0.8);
  }

  100% {
    box-shadow:
      0 0 20px 8px rgba(76, 175, 80, 0.3),
      0 -15px 20px -5px rgba(76, 175, 80, 0.8),
      0 0 20px 8px rgba(255, 193, 7, 0.3),
      15px 0 20px -5px rgba(255, 193, 7, 0.8);
  }
}

/* Update the animation durations and add transform scale effect */
.container.full.last-placed {
  animation: circle-glow-combined 3s linear infinite;
  transform: scale(1.02);
}

.container.full:not(.last-placed) {
  animation: circle-glow-full 3s linear infinite;
  transform: scale(1.02);
}

.container.last-placed:not(.full) {
  animation: circle-glow-last-placed 3s linear infinite;
  transform: scale(1.02);
}
</style>