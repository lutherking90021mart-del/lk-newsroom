const ACCRA = { latitude: 5.6037, longitude: -0.187, name: 'Accra' };
const CACHE_KEY = 'lk-weather-v1';
const CACHE_TTL = 10 * 60_000;

function conditionFor(code, isDay) {
  if ([95, 96, 99].includes(code)) return { kind: 'storm', label: 'Thunderstorm', icon: 'fa-cloud-bolt' };
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { kind: 'rain', label: code >= 80 ? 'Rain showers' : 'Rain', icon: 'fa-cloud-rain' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { kind: 'snow', label: 'Snow showers', icon: 'fa-snowflake' };
  if ([45, 48].includes(code)) return { kind: 'fog', label: 'Foggy', icon: 'fa-smog' };
  if (code === 3) return { kind: 'cloudy', label: 'Overcast', icon: 'fa-cloud' };
  if ([1, 2].includes(code)) return { kind: 'partly-cloudy', label: 'Partly cloudy', icon: isDay ? 'fa-cloud-sun' : 'fa-cloud-moon' };
  return { kind: isDay ? 'clear' : 'night', label: isDay ? 'Clear skies' : 'Clear night', icon: isDay ? 'fa-sun' : 'fa-moon' };
}

function readCache() {
  try {
    const data = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return data && Date.now() - data.savedAt < CACHE_TTL ? data : null;
  } catch { return null; }
}

function writeCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, savedAt: Date.now() })); } catch {}
}

async function fetchWeather(location) {
  const params = new URLSearchParams({
    latitude: String(location.latitude), longitude: String(location.longitude),
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,precipitation,rain,showers,wind_speed_10m', timezone: 'auto'
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Weather service returned ${response.status}`);
  const payload = await response.json();
  if (!payload.current) throw new Error('Weather service returned no current conditions.');
  return { location, current: payload.current };
}

function render(widget, data) {
  const current = data.current;
  const condition = conditionFor(Number(current.weather_code), Boolean(current.is_day));
  const temperature = Math.round(Number(current.temperature_2m));
  const feelsLike = Math.round(Number(current.apparent_temperature));
  const wind = Math.round(Number(current.wind_speed_10m));
  const rain = Number(current.precipitation || 0);
  widget.className = `sidebar-widget weather weather--${condition.kind}`;
  widget.innerHTML = `<div class="weather-heading"><span class="eyebrow" style="color:#fff">Live weather</span><span class="weather-updated">Updated now</span></div><div class="weather-main" aria-live="polite"><div class="weather-scene" aria-hidden="true"><i class="fa-solid ${condition.icon}"></i><span class="weather-rain"><b></b><b></b><b></b><b></b><b></b></span><span class="weather-lightning"></span></div><div><strong class="temp">${temperature}&deg;</strong><p class="weather-condition">${condition.label}</p></div></div><div class="weather-location"><i class="fa-solid fa-location-dot"></i> ${data.location.name} <button type="button" data-use-weather-location>Use my location</button></div><div class="weather-details"><span>Feels ${feelsLike}&deg;</span><span>${wind} km/h wind</span>${rain > 0 ? `<span>${rain.toFixed(1)} mm rain</span>` : ''}</div>`;
  widget.querySelector('[data-use-weather-location]')?.addEventListener('click', () => useVisitorLocation(widget));
}

async function update(widget, location, allowCache = true) {
  if (allowCache) {
    const cached = readCache();
    if (cached && cached.location?.latitude === location.latitude && cached.location?.longitude === location.longitude) {
      render(widget, cached);
      return;
    }
  }
  const data = await fetchWeather(location);
  writeCache(data);
  render(widget, data);
}

function useVisitorLocation(widget) {
  if (!navigator.geolocation) return;
  const button = widget.querySelector('[data-use-weather-location]');
  if (button) { button.disabled = true; button.textContent = 'Locating...'; }
  navigator.geolocation.getCurrentPosition(async position => {
    try { await update(widget, { latitude: position.coords.latitude, longitude: position.coords.longitude, name: 'Your location' }, false); }
    catch { if (button) { button.disabled = false; button.textContent = 'Try again'; } }
  }, () => {
    if (button) { button.disabled = false; button.textContent = 'Location unavailable'; }
  }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 15 * 60_000 });
}

/** Renders an Accra fallback immediately, then refreshes current conditions every 10 minutes. */
export async function initWeather() {
  const widget = document.querySelector('[data-weather-widget],.weather');
  if (!widget) return;
  try { await update(widget, ACCRA); }
  catch {
    widget.classList.add('weather--unavailable');
    const status = widget.querySelector('[data-weather-status]');
    if (status) status.replaceChildren('Live conditions are temporarily unavailable.');
    else widget.insertAdjacentHTML('beforeend', '<p class="weather-error">Live conditions are temporarily unavailable.</p>');
  }
  window.setInterval(() => { void update(widget, ACCRA, false).catch(() => {}); }, CACHE_TTL);
}
