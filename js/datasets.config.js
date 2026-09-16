/* ============================================================ */
/* DATASETS CONFIG - client-side                                 */
/* Fisierele brute din assets/data/raw/ sunt folosite ca atare.  */
/* Normalizarea (nume, filtrare, merge segmente) se face in      */
/* memorie, la incarcare, in data-loader.js.                     */
/* ============================================================ */
const DatasetsConfig = {

  /* Fisiere sursa (exporturi Overpass Turbo, nemodificate) */
  sources: {
    worldCountries: 'assets/data/raw/state_global_poligon.json',
    counties:  'assets/data/raw/judete_export.json',
    rivers:    'assets/data/raw/rauri_export.json',
    countries: 'assets/data/raw/tari_export.json',
    capitals:  'assets/data/raw/capitale_export.geojson',
    seats:     'assets/data/raw/resedinte_judet_export.geojson'
  },

  /* Definitiile exercitiilor */
  datasets: {

    /* ---------------- LUMEA ---------------- */

    'world-countries': {
      source: 'worldCountries',
      kind: 'polygon',
      region: 'world',
      title: 'Statele lumii',
      icon: '🌍',
      funFact: 'Rusia se întinde pe 11 fusuri orare.',
      gradient: 'linear-gradient(135deg, #2193b0 0%, #6dd5ed 100%)',
      nameField: ['name:ro', 'name:en', 'name'],
      dropNullGeometry: true,
      /* Exportul admin_level=2 include si teritorii dependente. */
      exclude: [
        'Anguilla', 'British Virgin Islands', 'Georgia de Sud și Insulele Sandwich de Sud',
        'Gibraltar', 'Guernsey', 'Insula Jersey', 'Insula Man',
        'Insulele Bermude', 'Insulele Cayman', 'Insulele Cook', 'Insulele Falkland',
        'Insulele Feroe', 'Insulele Pitcairn', 'Insulele Turks şi Caicos', 'Montserrat',
        'Niue', 'Saint Helena, Ascension and Tristan da Cunha',
        'Teritoriul Britanic din Oceanul Indian', 'Tokelau',
        /* Kosovo nu este inclus în lista de state folosită de acest joc. */
        'Kosovo'
      ],
      /* Groenlanda este teritoriu autonom al Danemarcei: apare pe harta
         Danemarcei, dar nu este o intrebare separata. */
      associatedTerritories: {
        'Danemarca': ['Groenlanda']
      },
      view: { center: [18, 10], zoom: 2, minZoom: 1 }
    },

    /* ---------------- ROMANIA ---------------- */

    'romania-counties': {
      source: 'counties',
      kind: 'polygon',
      region: 'romania',
      title: 'Județele României',
      icon: '🗺️',
      funFact: 'România este împărțită în 41 de județe și municipiul București.',
      gradient: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
      image: 'assets/images/backgrounds/romania-counties.jpg',
      nameField: ['name:ro', 'name'],
      /* doar cele 4 nume cu diacritice pierdute la export */
      nameFix: {
        'Bistria-Nsud': 'Bistrița-Năsăud',
        'Maramure': 'Maramureș',
        'Slaj': 'Sălaj',
        'Timi': 'Timiș'
      },
      /* Bucuresti apare ca admin_level=4, nu e judet */
      exclude: ['București', 'Bucureti', 'Municipiul București'],
      relief: true,
      view: { center: [45.9, 25.0], zoom: 7 }
    },

    'romania-capitals': {
      source: 'seats',
      kind: 'point',
      region: 'romania',
      title: 'Reședințe de județ',
      icon: '🏛️',
      funFact: 'Reședința de județ este localitatea care găzduiește administrația județeană.',
      gradient: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
      image: 'assets/images/backgrounds/romania-capitals.jpg',
      nameField: ['name:ro', 'name'],
      tolerance: 25000,
      relief: true,
      view: { center: [45.9, 25.0], zoom: 7 }
    },

    'romania-rivers': {
      source: 'rivers',
      kind: 'line',
      region: 'romania',
      title: 'Râurile României',
      icon: '🌊',
      funFact: 'Dunărea formează o parte importantă a graniței României și se varsă în Marea Neagră prin Delta Dunării.',
      gradient: 'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)',
      image: 'assets/images/backgrounds/romania-rivers.jpg',
      nameField: ['name:ro', 'name'],
      /* segmentele cu acelasi nume se unesc intr-un MultiLineString */
      mergeByName: true,
      /* Whitelist: raurile cerute la bacalaureat.
         Fara ea ar aparea 232 de paraie irelevante. */
      include: [
        'Barcău', 'Crișul Repede', 'Crișul Negru', 'Crișul Alb',
        'Someșul Mare', 'Someșul Mic',
        'Târnava Mică', 'Târnava Mare', 'Râul Cibin', 'Olt', 'Mureș',
        'Bega', 'Timiș', 'Dunărea', 'Motru', 'Râul Jiu', 'Vedea', 'Teleorman',
        'Argeș', 'Dâmbovița', 'Prahova', 'Trotuș', 'Bistrița', 'Moldova',
        'Suceava', 'Jijia', 'Siret', 'Prut', 'Bârlad',
        'Brațul Chilia', 'Brațul Sulina', 'Brațul Sfântu Gheorghe',
        'Buzău', 'Râul Ialomița', 'Călmățui'
      ],
      /* Dunarea nu e rau, ci fluviu */
      nameFix: {
        'Dunărea': 'Fluviul Dunărea',
        'Râul Cibin': 'Cibin',
        'Râul Jiu': 'Jiu',
        'Râul Ialomița': 'Ialomița'
      },

      tolerance: 15000,
      relief: true,
      view: { center: [45.9, 25.0], zoom: 7 }
    },

    /* ---------------- EUROPA ---------------- */

    'europe-countries': {
      source: 'countries',
      kind: 'polygon',
      region: 'europe',
      title: 'Țările Europei',
      icon: '🗺️',
      funFact: 'Europa este unul dintre cele șapte continente și are granițe culturale și geografice variate.',
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      image: 'assets/images/backgrounds/europe-countries.jpg',
      /* numele principal e in limba locala -> preferam romana */
      nameField: ['name:ro', 'name:en', 'name'],
      nameFix: {
        'Österreich': 'Austria',
        'Magyarország': 'Ungaria',
        'Schweiz/Suisse/Svizzera/Svizra': 'Elveția',
        'Elveţia': 'Elveția',
        'Regatul Unit al Marii Britanii și al Irlandei de Nord': 'Regatul Unit',
        'Țările de Jos': 'Olanda'
      },
      /* teritorii non-europene si dependente care nu sunt state suverane */
      exclude: [
        'Algeria', 'Tunisia', 'Maroc', 'Morocco', 'Siria', 'Syria',
        'Irak', 'Iraq', 'Iran', 'Groenlanda', 'Greenland',
        'Akrotiri și Dhekelia', 'Akrotiri and Dhekelia',
        'Sahara Occidentală', 'Western Sahara', 'Libia', 'Libya',
        'Egipt', 'Egypt', 'Israel', 'Iordania', 'Jordan', 'Liban', 'Lebanon',
        'Arabia Saudită', 'Saudi Arabia', 'Kuweit', 'Kuwait', 'Kazahstan',
        'Armenia', 'Azerbaidjan', 'Georgia',
        'Gibraltar', 'Guernsey', 'Insula Jersey', 'Insula Man', 'Insulele Feroe'
      ],
      /* Vatican are geometry: null in export */
      dropNullGeometry: true,
      view: { center: [54.0, 15.0], zoom: 4 }
    },

    'europe-capitals': {
      source: 'capitals',
      kind: 'point',
      region: 'europe',
      title: 'Capitalele Europei',
      icon: '🏛️',
      funFact: 'Vatican este cel mai mic stat din lume și se află în interiorul orașului Roma.',
      gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      image: 'assets/images/backgrounds/europe-capitals.jpg',
      nameField: ['name:ro', 'name'],
      /* whitelist: doar capitalele statelor europene */
      include: [
        'București', 'Sofia', 'Belgrad', 'Beograd', 'Zagreb', 'Ljubljana',
        'Sarajevo', 'Podgorica', 'Priștina', 'Prishtinë', 'Skopje', 'Tirana',
        'Atena', 'Athina', 'Roma', 'Valletta', 'Vaduz', 'Berna', 'Bern',
        'Viena', 'Wien', 'Bratislava', 'Budapesta', 'Budapest', 'Praga',
        'Praha', 'Varșovia', 'Warszawa', 'Berlin', 'Copenhaga', 'København',
        'Oslo', 'Stockholm', 'Helsinki', 'Tallinn', 'Riga', 'Rīga', 'Vilnius',
        'Minsk', 'Kiev', 'Kyiv', 'Chișinău', 'Moscova', 'Moskva', 'Amsterdam',
        'Bruxelles', 'Bruxelles - Brussel', 'Luxemburg', 'Luxembourg', 'Paris',
        'Madrid', 'Lisabona', 'Lisboa', 'Andorra la Vella', 'Londra', 'London',
        'Dublin', 'Baile Átha Cliath', 'Reykjavík', 'Reykjavik', 'Ankara',
        'San Marino', 'Monaco', 'Vatican', 'Città del Vaticano', 'Nicosia'
      ],
      /* normalizarea numelor catre forma romaneasca */
      nameFix: {
        'Beograd': 'Belgrad',
        'Prishtinë': 'Priștina',
        'Athina': 'Atena',
        'Bern': 'Berna',
        'Wien': 'Viena',
        'Budapest': 'Budapesta',
        'Praha': 'Praga',
        'Warszawa': 'Varșovia',
        'København': 'Copenhaga',
        'Rīga': 'Riga',
        'Kyiv': 'Kiev',
        'Moskva': 'Moscova',
        'Bruxelles - Brussel': 'Bruxelles',
        'Luxembourg': 'Luxemburg',
        'Lisboa': 'Lisabona',
        'London': 'Londra',
        'Baile Átha Cliath': 'Dublin',
        'Reykjavik': 'Reykjavík',
        'Città del Vaticano': 'Vatican'
      },
      tolerance: 60000,
      /* fundalul = exact harta jocului 'europe-countries' (aceleasi
         poligoane si acelasi stil), peste care se pun punctele */
      borders: 'europe-countries',
      view: { center: [54.0, 15.0], zoom: 4 }
    }
  },

  /* Ordinea in meniu: [rand][coloana].
     Randul 0 = Lumea, randul 1 = Europa, randul 2 = Romania.
     Muntii Europei / unitatile de relief lipsesc (nu avem seturi de date). */
  menu: [
    ['world-countries'],
    ['europe-countries', 'europe-capitals'],
    ['romania-counties', 'romania-capitals', 'romania-rivers']
  ],

  regionNames: ['Lumea', 'Europa', 'România'],

  get(id) {
    return this.datasets[id] || null;
  },

  ids() {
    return Object.keys(this.datasets);
  }
};

window.DatasetsConfig = DatasetsConfig;
