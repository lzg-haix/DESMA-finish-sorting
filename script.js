// odabiremo element raster
const raster = document.querySelector('.raster');

// generira 20 kontejnera s odgovarajućim klasama
for (let i = 1; i <= 20; i++) {
    // generira containere
    const container = document.createElement('div');
    container.classList.add('container');

    // generira detalje
    const rasterDetails = document.createElement('div');
    rasterDetails.classList.add('raster-details');
    rasterDetails.textContent = 'Info';

    // generira ID
    const rasterId = document.createElement('div');
    rasterId.classList.add('raster-id');
    rasterId.textContent = i;

    // appenda detalje i ID u kontejner
    container.appendChild(rasterDetails);
    container.appendChild(rasterId);

    // appenda kontejner u raster
    raster.appendChild(container);
}