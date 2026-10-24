# FilmoraX Extensions — SDK v1

Пакеты источников — подписанные ES-модули JavaScript, а не Dart-классы, APK,
DLL, Flutter-виджеты или страницы с WebView-плеером. Хост выполняет HTTP,
HTML-проекции, хранение настроек и воспроизведение. Разбор конкретного сайта
находится в пакете. Типы API: `sdk/index.d.ts`.

## Разработка и проверка

Источники разрабатываются непосредственно в этом репозитории. FilmoraX
не содержит их копий и не нужен для Node-тестов и упаковки. В этом checkout
нет Dart-кода, Flutter-runner и host integration fixtures.

```powershell
npm ci --ignore-scripts
npm test
npm run format:check
```

## Устройство репозитория

```text
extensions/
  sdk/                    общие функции и типы для авторов
  sources/anikage/         каталог, фильтры, серии и native streams
  sources/tmdb/            metadata-only источник
  sources/twodhive/        каталог и BabaStream AES/Cap/native streams
  sources/anitokyo*/       safe/NSFW-пакеты с общей реализацией
  sources/yummyani/        каталог, API и несколько providers
  sources/*/              все 16 источников; отдельные manifest и подпись
  resolvers/              общие JS-парсеры providers
  engines/                общие site engines без cross-channel source imports
  examples/torrserver/     декларативный пакет функции хоста
  examples/demo/           полный offline-пример API источника без сети
  tests/                  автономные проверки на фикстурах
  tools/pack.mjs           упаковка и подпись
  tools/package_format.mjs формат ZIP/JCS/Ed25519
  tools/release.mjs        полный или safe комплект с общим public record
```

Каждый проект содержит `manifest.json`, `LICENSE`, `src/index.mjs` и при
необходимости `assets/`. У декларативного feature-пакета каталога `src/` нет.
Логотип источника задаётся как `sources[].presentation.icon: "assets/icon.png"`:
подписанный статичный PNG, до 256 КиБ и 512×512. Логотипов конкретных сайтов в
Flutter bundle нет; хост заранее декодирует изображения установленных пакетов.

Сборка приложения от 24.10.2026 также поддерживает необязательное верхнее поле
`icon: "assets/icon.png"` в manifest пакета. Это иконка пакета/feature, например
TorrServer; ограничения и проверка PNG те же. Иконка входит в подписанный
`files`, не является внешним URL. Старые клиенты со строгой схемой без этого
поля отклонят пакет: сначала обновите приложение, не ослабляйте верификатор.
Происхождение добавленных изображений записано в `ICON_PROVENANCE.md`.

## Быстрый старт

Нужен Node 22+. Из корня `extensions`:

```powershell
npm ci --ignore-scripts
node --test tests/*.test.mjs
```

Скопируйте структуру источника, задайте собственные ID пакета и источника,
точные origins и возможности. Не копируйте чужой signing key. ID источника
стабилен между релизами: по нему хранятся история, настройки и библиотека.

Входная точка экспортирует синхронную фабрику:

```javascript
/** @type {import('../../../sdk/index.d.ts').SourceFactory} */
export default context => ({
  async getPopular({page = 1}) {
    const url = new URL('/api/catalog', context.baseUrl);
    url.searchParams.set('page', String(page));
    const {body} = await context.http.request({
      method: 'GET', url: url.href, responseType: 'json',
    });
    return {items: body.items.map(row => ({
      id: `my-source-${row.id}`, title: row.title, kind: 'movie',
      posterUrl: row.poster,
    })), hasMore: body.hasMore === true};
  },
  async getLatest(args) { return this.getPopular(args); },
  async loadDetails({itemId}) { return null; },
});
```

Это иллюстрация контракта, не готовый парсер реального сайта. `search` и прочие
методы обязательны, если соответствующая capability указана в manifest.
`loadDetails` обязателен у любого источника. `catalog` требует и `getPopular`,
и `getLatest`. `metadataOnly` несовместим со `streams`.

Во время import/factory запрещены HTTP, настройки, auth и прочие host calls.
Установщик проверяет фабрику и методы офлайн **до** активации пакета.

## Контракт результатов

- Результат — только конечные JSON-значения: без `undefined`, NaN, функций,
  циклических ссылок, Date, DOM-объектов и экземпляров произвольных классов.
- Страница — `{items, hasMore}`; не угадывайте следующую страницу по длине,
  если API/HTML предоставляет признак следующей страницы.
- `providerName` и `sourceId` назначает хост из manifest. Не возвращайте их в DTO.
  `webUrl` — публичная ссылка на тайтл; она проверяется по HTTP/web grants.
  ID, названия, overview и metadata
  задаёт расширение. Разметку описания преобразуйте через `html.text`.
- Метаданные с `filterId`/`filterValue` позволяют открывать фильтр из карточки.
- Related items ограничены одним уровнем: в рекомендации не вкладывают
  следующие рекомендации.
- Эпизод содержит стабильный ID и HTTPS URL либо собственную resolver-схему.
  Схему объявляют в `resolvers`; её нельзя передавать системному браузеру.
- `playerId` / `playerLabel` — стабильная идентичность и название provider.
  Можно задать на группе (эпизоды унаследуют) или переопределить на эпизоде.
  Не используйте URL, временный token, episode ID или номер серии как `playerId`:
  этот ключ сохраняется в предпочтениях пользователя между сериями.
- `posterWidth` — настоящая ширина компактной миниатюры, если известна источнику.
  Host не угадывает её по имени файла и не декодирует изображение с увеличением.
- Поток — native MP4/HLS/DASH/WebM/MKV с корректным MIME, не embed/HTML.
  У одного HLS master должна быть одна запись `auto`; фиксированные варианты
  дедуплицируются по URL/качеству/MIME. Субтитры возвращаются отдельно.
  Для короткоживущей ссылки задайте `refreshBeforePlay: true` на variant, если
  требуется обновление после паузы на стартовом экране перед первым Play.
  `requiresHlsProxy: true` включает совместимость с обёрнутыми HLS-сегментами,
  только если она действительно нужна данному provider; host не угадывает домен.
- Ошибки бросайте с `code` из SDK: `network`, `not_found`, `auth_required`,
  `challenge_required`, `stream_unavailable`, `parse_error` и т. п. Отмена,
  запрет доступа и лимит ресурсов не должны превращаться в перебор серверов.

## HTTP и безопасность

`origins`, `imageOrigins`, `streamOrigins` — явные HTTPS origins без путей и
wildcard. Запросы, изображения и streams проверяются отдельно. Хост не делает
автоматических POST redirects и проверяет каждый GET redirect. Authorization
из исходного запроса не переносится на другой origin. TLS/SNI проверяются для
исходного имени хоста; недоверенных сертификатов хост не принимает.
`webOrigins` разрешает публичные ссылки карточек, но **не** сетевые запросы
расширения. Например, ссылка TMDB на www-сайт не выдаёт парсеру доступ к нему.

Имена хостов, а не диапазоны IP, определяют grant: системные DNS/VPN fake-IP
маршруты допустимы. Не объявляйте это полной блокировкой локальной сети.

`http.request` поддерживает ограниченный набор заголовков и body только для
POST. Cookie/Host/Connection не принимаются от скрипта. `Authorization` возможен
только при `sourceSession` и точном `authOrigins` для адресата. Cookies не
возвращаются JavaScript как response headers. Общий Dio приложения не передаёт
источнику глобальные cookies/headers.

Чтение собственного токена требует `sourceSession` и явного
`auth.getSession({includeAccessToken:true})`. Это привилегия доверенного кода:
такому издателю нельзя давать доступ без проверки отпечатка. Не логируйте
токены, cookie, подписанные stream URLs и ответы auth API. Текущее подключение
cookie-сессий привязано к signed auth origins. Ответы Set-Cookie обслуживает
ограниченный transient jar: digest + source + generation + exact origin/path,
expiry/LRU. Он не меняет пользовательскую capture-сессию и не отдаёт cookies JS.
Статические несекретные flags можно объявить в `network.cookieDefaults`.

Для входа через WebView объявите capability `auth`, разрешение `sourceSession`,
`web.loginUrl`, `web.cookieOrigins` и точные `network.authOrigins` (внутри HTTP
grants). `network.userAgentProfile` задаёт общий профиль браузера и HTTP:
`app`, `browser` или `mobileSafari`. Для браузерной проверки обычно нужен
`browser`; явный профиль отдельного `http.request` должен быть согласован
с профилем, использованным для получения cookie. Произвольная строка UA в
этом поле запрещена. Хост читает cookies через API браузера, включая HttpOnly,
но только для объявленных источником HTTPS origins; расширению cookies не выдаются.

Для native MP4/WebM/MKV на точном `authOrigins` хост подставляет source session
через ограниченный loopback streaming broker. Native consumer получает только
непредсказуемый локальный URL, без Authorization/Cookie. Range/HEAD поддержаны;
каждый redirect проверяется заново, credentials на чужие CDN не передаются.
Изменение токена, cookies, зеркала или headers отзывает старые media capabilities.
Сессия живёт до освобождения последнего playback/download/export lease.
Публичные потоки остаются прямыми, без дополнительного relay и буферизации видео.
Session-bound HLS/DASH пока не поддержан: он отклоняется явно, а не раскрывает
секреты через плейлисты. Текущий auth-only AniLib использует single-file MP4.

`settings.get/set` — отдельное пространство издателя/пакета/источника, до 32 KiB
на значение. Оно не меняет сетевые разрешения. `settings.network()` читает
пользовательские настройки основного приложения, но не записывает их.

Для пользовательских зеркал manifest может разрешить `allowUserBaseUrl` и
`settingsOrigins` — отображение имён пользовательских options в `http`,
`httpAndAuth`, `image`, `stream`. Только хост читает эти настройки и расширяет
grants. Пакет не может сам записать туда произвольный origin.

## Представление и настройки источника

`presentation` — только данные: `directPlayback` (bool), `artworkLayout`
(`portrait` / `landscape`), `accessTokenHint` и `imageHeaders`. Необязательный
`accessTokenHint` — текст/ключ перевода до 160 символов общей формы токена.
Для artwork допустимы только
User-Agent, Accept, Accept-Language, Referer, Origin; cookies и токены запрещены.
В Referer/Origin можно использовать `{baseOrigin}` / `{imageOrigin}`.
Хост сохраняет эти несекретные defaults вместе с карточкой и меняет cache key
при изменении заголовков: старые AVIF-байты не подменяют новый JPEG-запрос.

`networkSettings` — до 16 декларативных полей общей формы настроек. Поддержаны
`select`, `url`, `text`, `id`, `label`, `defaultValue`, `required`, `options`.
У select option — `value`, `label`, необязательный `description`; максимум 32.
`visibleWhen: {id, values}` ссылается только на **предыдущий** select.
`defaultFromBaseUrl` задаёт значение select для миграции старого custom base URL.
Имена полей сохраняются в `settings.network().options`; существующие ключи
нужно сохранять между версиями. Для URLs, расширяющих network grants, отдельно
объявляют `network.settingsOrigins`. Сама форма разрешений не выдаёт.
Пример независимых API/image mirrors находится в `sources/tmdb/manifest.json`.
Не добавляйте в manifest Dart callbacks, имена виджетов или исполняемые validators.

## HTML без WebView

```javascript
const {body} = await context.http.request({
  method:'GET', url:context.baseUrl, responseType:'text',
});
const rows = await context.html.extract(body, {
  selector:'.tile', all:true,
  fields:{
    name:{selector:'.title',text:true,required:true},
    url:{selector:'a',attr:'href',absoluteUrl:true},
    image:{selector:'img',attr:'src',absoluteUrl:true},
  },
});
```

Проекция не запускает scripts/handlers страницы и не предоставляет живой DOM.
Большие JSON и HTML разбираются в доверенном Dart isolate вне UI потока.
Несколько описаний передавайте в `html.text([...])`: один batch, без запуска
отдельного isolate на каждую карточку. Не создавайте обёртки HTML вокруг
непроверенных описаний для сопоставления по индексам.

## Лимиты и отзывчивость

- JS: отдельный worker, лимиты памяти/CPU/IPC; обычная операция ограничена
  30 секундами. Signed `runtime.resolveTimeoutMs` может дать resolver до 60 секунд.
- В registry одновременно не более четырёх resident source processes;
  незанятые вытесняются по LRU. Разные источники не сериализуются глобально.
- У одного source context вызовы последовательны; внутренняя загрузка
  независимых endpoints может использовать ограниченный `Promise.all`.
- HTTP body до 4 MiB (bytes до 1 MiB), JSON IPC до 8 MiB; queued requests
  отменяются вместе с UI запросом. Не оставляйте фоновые promises после result.
- Каталог до 200 карточек на страницу, фильтры до 64, options до 2048,
  variants/subtitles до 128. Не отдавайте весь каталог вместо пагинации.
- Не выполняйте бесконечные retry, polling и тяжёлый PoW в фабрике. Сначала
  проверяйте contract, ограничения CPU и корректную отмену на фикстурах.

Для криптографии есть отдельное разрешение `crypto`: AES-256-GCM encrypt/decrypt
и bounded SHA-256 nonce search, PBKDF2-SHA256, AES-CBC/PKCS7 и bounded
ChaCha20 candidates. Протокол сайта, challenge derivation и проверка
его результатов находятся в расширении; host не знает адресов/параметров Cap
или BabaStream. Поиск nonce выполняется в отменяемом isolate до 25 секунд.
`html.extractMany` аналогично пакетно обрабатывает embed snippets; не запускайте
сотни host calls / parser isolates через `Promise.all` для списка серий.

## Упаковка и подпись

```powershell
# Ключ хранить вне репозитория. Команда никогда не перезаписывает существующий.
node tools/pack.mjs keygen --private D:/private/filmorax-dev.pem
node tools/pack.mjs --project sources/anikage --key D:/private/filmorax-dev.pem --key-id my.publisher --output dist/anikage-1.0.0.fxextension
```

Упаковщик собирает imports, включая общий SDK, в один ESM; не требуются внешние
модули при исполнении. Рядом создаются public record и SHA-256 архива. `files`
заполняется размерами и SHA-256 автоматически. Канонический manifest
подписывается Ed25519 с domain separator `FilmoraX extension package v1\n`.
ZIP воспроизводим: фиксированная дата, сортировка, без symlinks/ZIP64.

Приватный ключ не добавляют в пакет, public record, Git, assets или логи.
Public record сам по себе не делает издателя доверенным. В настройках
«Расширения» пользователь отдельно импортирует public record, проверяет
отпечаток через доверенный канал и подтверждает package/feature grants;
после этого импортирует `.fxextension`.

Альтернатива локальному импорту: «Расширения» → «Добавить репозиторий».
Введите HTTPS URL `release.json` (либо каталога релиза) и **независимо полученный**
SHA-256 fingerprint издателя. Хост проверит public record, detached-подпись
inventory, channel и каждый скачанный архив. Затем отдельно подтвердите trust,
разрешения пакета и, при необходимости, привязку исторического source ID.
Кнопки установки/обновления находятся в карточке репозитория; обновление списка
не устанавливает код и не расширяет grants автоматически. Репозитории хранятся
в текущем профиле, не обращаются к сети при старте приложения; удаление записи
репозитория не удаляет установленные пакеты и не отзывает издателя.

Исторические source IDs зарезервированы в app-owned migration data. Первая
установка требует **отдельного** подтверждения привязки их старых cookies,
API-токенов и заголовков конкретному пакету/издателю. Обычное подтверждение
public key этого разрешения не заменяет. После привязки ownership сохраняется
при uninstall/revoke: другой издатель не перехватывает ID повторной установкой.

### Полный комплект для распространения

```powershell
node tools/release.mjs --key D:/private/filmorax-release.pem --key-id filmorax.sources --output dist/release-1
node tools/release.mjs --key D:/private/filmorax-release.pem --key-id filmorax.sources --output dist/release-1-standard --channel standard
node tools/release.mjs --key D:/private/filmorax-release.pem --key-id filmorax.sources --output dist/release-1-nsfw --channel nsfw
```

Команда создаёт immutable каталог пакетов текущего канала, общий `publisher.public.json`, fingerprint,
SHA-256 архивов, `release.json` и detached Ed25519 `release.ed25519` с domain
`FilmoraX extension release v1\n`. Ключ читается из указанного файла, не создаётся
и никуда не копируется. Существующий output не перезаписывается.

Подпись каталога — дополнительная проверка release inventory; каждый `.fxextension`
подписан независимо. UI принимает HTTPS URL `release.json` с независимо проверенным fingerprint,
показывает пакеты и обновления; автоматической установки/доверия нет.
Публикацию артефактов и проверенного fingerprint выполняет владелец проекта;
инструмент ничего не публикует, не устанавливает и не добавляет в доверенные.

### Самостоятельный репозиторий

Этот checkout — единственное место разработки источников своего канала.
Генератор репозиториев из основного приложения больше не используется.
`repository.json` ограничивает IDs и features; README описывает CI, ключи
и публикацию GitHub Release. Другой канал не нужен для Node-тестов/упаковки.

Версия — SemVer. Один version не может обозначать два разных архива.
Автоматическое понижение запрещено. В менеджере «Предыдущие версии» доступны три
последних установленных архива: digest, подпись и grants проверяются повторно,
затем пользователь подтверждает откат. Подложенный в папку архив не становится
версией для отката. Активный плеер, login или transfer блокирует обычный update/rollback.
После удаления сохраняются настройки, архивы rollback и ownership ID.
Отзыв издателя отключает исполнение немедленно, не стирая пользовательские данные.

## Пакеты функций приложения

`examples/torrserver/manifest.json` не имеет entrypoint, sources, resolvers или
permissions. `contributions.hostFeatures` содержит `torrents.torrserver`.
Установка такого пакета не загружает нативный код: она выдаёт доступ к
зарегистрированному модулю хоста. Неизвестные feature IDs отвергаются.

Guard проверяет не только видимость кнопки, но и открытие маршрута, создание
stream URL, HTTP transport и время жизни активной операции. Обычное удаление /
выключение занятой функции блокируется до завершения просмотра; отзыв доверия
отменяет активные leases. Уже запущенный внешний VLC хост остановить не может.
Встроенный source playback также удерживает lease поколения: обычное выключение
занятого источника блокируется, revoke закрывает плеер и отменяет resolver IO.
Скачанные локальные файлы остаются пользовательскими и не требуют source lease.

Пакет не может объявить новый Flutter route, method channel, DLL или произвольную
страницу настроек. Для новой функции сначала добавляется проверенный модуль в
host registry и contract, затем отдельный декларативный пакет.

## Проверки перед выпуском

1. Моки HTTP/HTML для каталога, поиска и каждого фильтра; page 1/2/last/empty.
2. Details, metadata links, рекомендации, стабильность episode/group IDs.
3. Все providers, качества, HLS auto, субтитры; HTML не принимается за stream.
4. Некорректный JSON/HTML, 401/403/404/429/5xx, redirect, timeout и cancel.
5. Заголовки, токен, зеркало, cookie isolation; запрещённые origins и файлы.
6. Подпись, повторная упаковка, обновление/rollback, revoke/disable во время IO.
7. Сквозной тест подписанного архива через настоящий OS worker и broker.
8. Контроль каталога/навигации на телефоне, ТВ и ПК после полной интеграции.

Все тесты этого репозитория — JavaScript/Node fixtures; запускайте `npm test`.
Они не загружают приложение, не требуют Flutter и не создают доверенный
production publisher. Для подписанного CI-only комплекта: `npm run release:ci`.

## Платформы и ограничения

Windows: AppContainer worker без сетевых capabilities; Android: isolated
service без разрешений UID приложения, сетевой доступ только через broker.
Android интеграция добавлена, но устройство в этой задаче не запускалось.
По согласованному объёму iOS не требуется. Для iOS/macOS/Linux OS runtime
не реализован: JS-пакет не должен
активироваться на неподдерживаемой платформе. Feature-only пакеты JavaScript
не исполняют. Это ограничение нельзя скрывать Dart fallback-источником.

Разделы исходного проекта и QuickJS имеют отдельное происхождение и лицензии:
см. `PROVENANCE.md` и `third_party/quickjs_ng/LICENSE`.
