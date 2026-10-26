import type { UnitBudget } from "../bundle-budget";

export default {
  unit: "FRONTEND-021",
  entryJsGzipGrowth: 300,
  entryJsRawGrowth: 700,
  entryCssGzipGrowth: 0,
  changed: {
    ComposePage: 4200,
    StatsNavigator: 3600,
    RecordsTab: 3600,
    PlayersTab: 700,
    "Stats.module": 450,
    "css:Stats.css": 550,
    "css:ComposePage.css": 500,
  },
  added: {
    StatsPicker: 2600,
    "css:StatsPicker.css": 500,
    PlayerResults: 900,
    stats: 850,
    "StatsNav.module": 350,
    "css:StatsNav.css": 1150,
  },
} satisfies UnitBudget;
