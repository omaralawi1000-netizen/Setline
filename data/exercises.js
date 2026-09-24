// Exercise catalog. muscles[0] is the primary group.
// Muscle keys: chest back shoulders biceps triceps forearms quads hamstrings glutes adductors calves core traps
// Equipment keys: barbell dumbbell machine cable bodyweight kettlebell ezbar smith trapbar

const x = (id, en, da, muscles, equipment, aliases = []) => ({ id, en, da, muscles, equipment, aliases });

export const EXERCISES = [
  // chest
  x('bench-press', 'Bench press', 'Bænkpres', ['chest', 'triceps', 'shoulders'], 'barbell', ['bench', 'barbell bench press', 'flat bench', 'baenk', 'bænk', 'bænkpres med stang']),
  x('incline-bench-press', 'Incline bench press', 'Skrå bænkpres', ['chest', 'shoulders', 'triceps'], 'barbell', ['incline bench', 'incline barbell press', 'skråbænk', 'skrå bænk']),
  x('close-grip-bench-press', 'Close-grip bench press', 'Bænkpres med smalt greb', ['triceps', 'chest'], 'barbell', ['close grip bench', 'smalt greb bænkpres', 'smal bænkpres']),
  x('dumbbell-bench-press', 'Dumbbell bench press', 'Bænkpres med håndvægte', ['chest', 'triceps', 'shoulders'], 'dumbbell', ['db bench', 'dumbbell press', 'håndvægt bænkpres', 'haandvaegt baenkpres']),
  x('incline-dumbbell-press', 'Incline dumbbell press', 'Skrå pres med håndvægte', ['chest', 'shoulders', 'triceps'], 'dumbbell', ['incline db press', 'incline dumbbell bench', 'skrå håndvægtspres', 'skråpres']),
  x('dumbbell-fly', 'Dumbbell fly', 'Flyes med håndvægte', ['chest'], 'dumbbell', ['flyes', 'flys', 'chest fly', 'dumbbell flyes']),
  x('cable-crossover', 'Cable crossover', 'Kabel-crossover', ['chest'], 'cable', ['cable fly', 'crossover', 'kabel flyes', 'cable flyes']),
  x('machine-chest-press', 'Machine chest press', 'Brystpres i maskine', ['chest', 'triceps'], 'machine', ['chest press', 'brystpres', 'maskine brystpres']),
  x('pec-deck', 'Pec deck', 'Butterfly-maskine', ['chest'], 'machine', ['butterfly', 'pec fly', 'machine fly', 'butterfly maskine']),
  x('push-up', 'Push-up', 'Armstrækning', ['chest', 'triceps', 'shoulders'], 'bodyweight', ['push-ups', 'pushups', 'pushup', 'armstrækninger', 'armbøjning', 'armbøjninger']),
  x('dip', 'Dip', 'Dips', ['triceps', 'chest'], 'bodyweight', ['dips', 'chest dip', 'parallel bar dip']),

  // back
  x('deadlift', 'Deadlift', 'Dødløft', ['back', 'hamstrings', 'glutes'], 'barbell', ['conventional deadlift', 'deadlifts', 'dodloft', 'dødløft med stang']),
  x('sumo-deadlift', 'Sumo deadlift', 'Sumo-dødløft', ['glutes', 'back', 'quads'], 'barbell', ['sumo', 'sumo dødløft']),
  x('romanian-deadlift', 'Romanian deadlift', 'Rumænsk dødløft', ['hamstrings', 'glutes', 'back'], 'barbell', ['rdl', 'romanian', 'rumænsk', 'stiff leg deadlift', 'strakt dødløft']),
  x('trap-bar-deadlift', 'Trap bar deadlift', 'Trapbar-dødløft', ['quads', 'glutes', 'back'], 'trapbar', ['hex bar deadlift', 'trap bar', 'hexbar', 'trapbar dødløft']),
  x('barbell-row', 'Barbell row', 'Roning med stang', ['back', 'biceps'], 'barbell', ['bent over row', 'row', 'roning', 'rows', 'bent-over row', 'stangroning', 'foroverbøjet roning']),
  x('pendlay-row', 'Pendlay row', 'Pendlay-roning', ['back', 'biceps'], 'barbell', ['pendlay', 'pendlay roning']),
  x('dumbbell-row', 'Dumbbell row', 'Roning med håndvægt', ['back', 'biceps'], 'dumbbell', ['one arm row', 'single arm row', 'db row', 'håndvægtsroning', 'etarms roning']),
  x('seated-cable-row', 'Seated cable row', 'Siddende kabelroning', ['back', 'biceps'], 'cable', ['cable row', 'seated row', 'kabelroning', 'siddende roning']),
  x('t-bar-row', 'T-bar row', 'T-bar-roning', ['back', 'biceps'], 'barbell', ['t bar row', 'tbar', 't-bar roning']),
  x('pull-up', 'Pull-up', 'Pull-ups', ['back', 'biceps'], 'bodyweight', ['pull-ups', 'pullups', 'pullup', 'pull ups', 'kropshævning', 'kropshævninger']),
  x('chin-up', 'Chin-up', 'Chin-ups', ['back', 'biceps'], 'bodyweight', ['chin-ups', 'chinups', 'chinup', 'chin ups', 'underhåndsgreb pull-ups']),
  x('lat-pulldown', 'Lat pulldown', 'Lat pulldown', ['back', 'biceps'], 'cable', ['pulldown', 'lat pull down', 'pull down', 'nedtræk', 'lat nedtræk', 'træk til brystet']),
  x('straight-arm-pulldown', 'Straight-arm pulldown', 'Nedtræk med strakte arme', ['back'], 'cable', ['straight arm pulldown', 'lat prayer', 'strakte arme nedtræk']),
  x('back-extension', 'Back extension', 'Rygstrækning', ['back', 'glutes', 'hamstrings'], 'bodyweight', ['hyperextension', 'hyperextensions', 'rygbøjning', 'rygstræk']),

  // shoulders
  x('overhead-press', 'Overhead press', 'Militærpres', ['shoulders', 'triceps'], 'barbell', ['ohp', 'military press', 'shoulder press', 'strict press', 'press', 'militaerpres', 'skulderpres med stang', 'stående pres']),
  x('dumbbell-shoulder-press', 'Dumbbell shoulder press', 'Skulderpres med håndvægte', ['shoulders', 'triceps'], 'dumbbell', ['db shoulder press', 'seated dumbbell press', 'skulderpres', 'håndvægt skulderpres']),
  x('arnold-press', 'Arnold press', 'Arnold-pres', ['shoulders', 'triceps'], 'dumbbell', ['arnold', 'arnold pres']),
  x('push-press', 'Push press', 'Push press', ['shoulders', 'triceps', 'quads'], 'barbell', ['pushpress']),
  x('lateral-raise', 'Lateral raise', 'Sidehæv', ['shoulders'], 'dumbbell', ['lateral raises', 'side raise', 'side raises', 'lateral', 'laterals', 'sidehæv med håndvægte', 'sideløft']),
  x('cable-lateral-raise', 'Cable lateral raise', 'Sidehæv i kabel', ['shoulders'], 'cable', ['cable lateral', 'kabel sidehæv']),
  x('rear-delt-fly', 'Rear delt fly', 'Omvendt flyes', ['shoulders', 'back'], 'dumbbell', ['reverse fly', 'rear fly', 'reverse flyes', 'bagskulder flyes', 'omvendte flyes']),
  x('face-pull', 'Face pull', 'Face pull', ['shoulders', 'back'], 'cable', ['face pulls', 'facepull', 'facepulls']),
  x('upright-row', 'Upright row', 'Opret roning', ['shoulders', 'traps'], 'barbell', ['upright rows', 'opretstående roning']),
  x('barbell-shrug', 'Barbell shrug', 'Skuldertræk med stang', ['traps'], 'barbell', ['shrug', 'shrugs', 'skuldertræk', 'shrugs med stang']),
  x('dumbbell-shrug', 'Dumbbell shrug', 'Skuldertræk med håndvægte', ['traps'], 'dumbbell', ['db shrug', 'dumbbell shrugs', 'shrugs med håndvægte']),

  // arms
  x('barbell-curl', 'Barbell curl', 'Biceps curl med stang', ['biceps'], 'barbell', ['curl', 'curls', 'bicep curl', 'biceps curl', 'stangcurl', 'curl med stang']),
  x('dumbbell-curl', 'Dumbbell curl', 'Biceps curl med håndvægte', ['biceps'], 'dumbbell', ['db curl', 'dumbbell curls', 'håndvægtscurl', 'curl med håndvægte']),
  x('hammer-curl', 'Hammer curl', 'Hammercurl', ['biceps', 'forearms'], 'dumbbell', ['hammer curls', 'hammer', 'hammer curl']),
  x('preacher-curl', 'Preacher curl', 'Scottcurl', ['biceps'], 'ezbar', ['preacher', 'scott curl', 'preacher curls', 'scott curls']),
  x('ez-bar-curl', 'EZ-bar curl', 'Curl med EZ-stang', ['biceps'], 'ezbar', ['ez curl', 'ez bar curl', 'ez-stang curl']),
  x('cable-curl', 'Cable curl', 'Curl i kabel', ['biceps'], 'cable', ['cable curls', 'kabelcurl', 'kabel curl']),
  x('triceps-pushdown', 'Triceps pushdown', 'Triceps pushdown', ['triceps'], 'cable', ['pushdown', 'tricep pushdown', 'rope pushdown', 'cable pushdown', 'triceps press ned', 'pushdowns']),
  x('overhead-triceps-extension', 'Overhead triceps extension', 'Triceps-ekstension over hovedet', ['triceps'], 'cable', ['overhead extension', 'overhead tricep extension', 'french press', 'fransk pres', 'triceps over hovedet']),
  x('skull-crusher', 'Skull crusher', 'Skull crusher', ['triceps'], 'ezbar', ['skull crushers', 'skullcrusher', 'lying triceps extension', 'liggende triceps ekstension', 'liggende fransk pres']),
  x('wrist-curl', 'Wrist curl', 'Håndledscurl', ['forearms'], 'barbell', ['wrist curls', 'håndledscurls', 'underarmscurl']),

  // legs
  x('back-squat', 'Squat', 'Knæbøj', ['quads', 'glutes', 'hamstrings'], 'barbell', ['squat', 'squats', 'back squat', 'barbell squat', 'knaeboej', 'knæbøjninger', 'squat med stang', 'squats med stang']),
  x('front-squat', 'Front squat', 'Frontsquat', ['quads', 'glutes', 'core'], 'barbell', ['front squats', 'front knæbøj', 'frontbøj']),
  x('goblet-squat', 'Goblet squat', 'Goblet squat', ['quads', 'glutes'], 'kettlebell', ['goblet', 'goblet squats', 'goblet knæbøj']),
  x('leg-press', 'Leg press', 'Benpres', ['quads', 'glutes'], 'machine', ['legpress', 'benpresser', 'ben pres']),
  x('hack-squat', 'Hack squat', 'Hack squat', ['quads', 'glutes'], 'machine', ['hack', 'hack squats', 'hacksquat']),
  x('bulgarian-split-squat', 'Bulgarian split squat', 'Bulgarsk split squat', ['quads', 'glutes'], 'dumbbell', ['bulgarian', 'split squat', 'bulgarian split squats', 'bulgarsk', 'bulgarske']),
  x('walking-lunge', 'Walking lunge', 'Gående udfald', ['quads', 'glutes'], 'dumbbell', ['lunges', 'lunge', 'walking lunges', 'udfald', 'udfaldsskridt']),
  x('leg-extension', 'Leg extension', 'Benstræk', ['quads'], 'machine', ['leg extensions', 'knee extension', 'benstrækker', 'quad extension']),
  x('lying-leg-curl', 'Lying leg curl', 'Liggende lårcurl', ['hamstrings'], 'machine', ['leg curl', 'hamstring curl', 'lårcurl', 'liggende bencurl', 'bencurl']),
  x('seated-leg-curl', 'Seated leg curl', 'Siddende lårcurl', ['hamstrings'], 'machine', ['seated hamstring curl', 'siddende bencurl']),
  x('hip-thrust', 'Hip thrust', 'Hip thrust', ['glutes', 'hamstrings'], 'barbell', ['hip thrusts', 'barbell hip thrust', 'glute bridge', 'hofteløft']),
  x('standing-calf-raise', 'Standing calf raise', 'Stående tåhæv', ['calves'], 'machine', ['calf raise', 'calf raises', 'tåhæv', 'lægløft', 'stående lægløft']),
  x('seated-calf-raise', 'Seated calf raise', 'Siddende tåhæv', ['calves'], 'machine', ['seated calf', 'siddende lægløft']),
  x('hip-adduction', 'Hip adduction', 'Hofteadduktion', ['adductors'], 'machine', ['adductor', 'adductors', 'inner thigh', 'adduktor', 'adduktorer']),
  x('hip-abduction', 'Hip abduction', 'Hofteabduktion', ['glutes'], 'machine', ['abductor', 'abductors', 'outer thigh', 'abduktor', 'abduktorer']),

  // core and full body
  x('plank', 'Plank', 'Planke', ['core'], 'bodyweight', ['planks', 'planken']),
  x('hanging-leg-raise', 'Hanging leg raise', 'Hængende benløft', ['core'], 'bodyweight', ['leg raise', 'leg raises', 'hanging leg raises', 'benløft', 'hængende benhæv']),
  x('cable-crunch', 'Cable crunch', 'Kabel-crunch', ['core'], 'cable', ['cable crunches', 'kneeling crunch', 'kabel crunch', 'crunch i kabel']),
  x('ab-wheel', 'Ab wheel rollout', 'Mavehjul', ['core'], 'bodyweight', ['ab wheel', 'rollout', 'ab roller', 'mavehjulet', 'ab rollout']),
  x('kettlebell-swing', 'Kettlebell swing', 'Kettlebell-sving', ['glutes', 'hamstrings', 'back'], 'kettlebell', ['kb swing', 'swings', 'kettlebell swings', 'kettlebell sving', 'svingning']),
  x('farmers-walk', 'Farmer’s walk', 'Farmer’s walk', ['forearms', 'traps', 'core'], 'dumbbell', ['farmers walk', 'farmer walk', 'farmers carry', 'bondegang']),
  x('power-clean', 'Power clean', 'Power clean', ['quads', 'glutes', 'back'], 'barbell', ['clean', 'cleans', 'frivending'])
];
