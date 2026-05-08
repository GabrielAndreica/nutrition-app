-- Tabel pentru stocarea alimentelor și valorilor nutriționale
-- Toate valorile sunt per 100g (sau 100ml pentru lichide)
CREATE TABLE foods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  aliases TEXT[] DEFAULT '{}',
  calories_per_100g NUMERIC NOT NULL,
  protein_per_100g NUMERIC NOT NULL,
  carbs_per_100g NUMERIC NOT NULL,
  fat_per_100g NUMERIC NOT NULL,
  category TEXT NOT NULL,
  -- categorii: 'meat', 'fish', 'eggs', 'dairy', 'grains', 'starch', 'legumes', 'vegetables', 'fruits', 'nuts', 'fats', 'other'
  diet_types TEXT[] DEFAULT '{"omnivore","vegetarian","vegan"}',
  -- alimentele excluse din anumite diete (ex: carnea nu e vegetariană/vegană)
  allergens TEXT[] DEFAULT '{}',
  -- ex: '{"gluten","lactate","oua","peste","nuci","soia"}'
  max_amount_per_meal NUMERIC DEFAULT 200,
  -- cantitate maximă rezonabilă per masă (grame)
  grams_per_unit NUMERIC DEFAULT NULL,
  -- pentru alimente unitare (1 ou = 60g, 1 banană = 120g)
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index pentru căutări rapide
CREATE INDEX idx_foods_category ON foods(category);
CREATE INDEX idx_foods_diet_types ON foods USING GIN(diet_types);
CREATE INDEX idx_foods_allergens ON foods USING GIN(allergens);
CREATE INDEX idx_foods_is_active ON foods(is_active);

-- Trigger pentru actualizarea automată a updated_at
CREATE OR REPLACE FUNCTION update_foods_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER foods_updated_at
  BEFORE UPDATE ON foods
  FOR EACH ROW
  EXECUTE FUNCTION update_foods_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════════
-- INSERARE ALIMENTE
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── CARNE DE PUI (valori CRUDE / raw) ───────────────────────────────────────
INSERT INTO foods (name, aliases, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category, diet_types, allergens, max_amount_per_meal) VALUES
('Piept de pui', '{"piept pui","pui","chicken breast","piept de pui","piept pui crud","piept de pui crud","piept pui fiert","pui fiert","piept pui gratar","pui gratar","piept pui cuptor","pui cuptor","pui la gratar","pui la cuptor","chicken","pui grill"}', 120, 22, 0, 2.6, 'meat', '{"omnivore"}', '{}', 250),
('Pulpă de pui', '{"pulpa pui","pulpa de pui","pui pulpa","pulpa pui fara os","pulpa pui copta","chicken thigh"}', 172, 17, 0, 11, 'meat', '{"omnivore"}', '{}', 300);

-- ─── CURCAN (valori CRUDE) ────────────────────────────────────────────────────
INSERT INTO foods (name, aliases, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category, diet_types, allergens, max_amount_per_meal) VALUES
('Piept de curcan', '{"curcan","piept curcan","curcan crud","curcan fiert","curcan cuptor","curcan la cuptor","turkey breast"}', 104, 24, 0, 0.7, 'meat', '{"omnivore"}', '{}', 250);

-- ─── CARNE DE VITĂ (valori CRUDE) ─────────────────────────────────────────────
INSERT INTO foods (name, aliases, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category, diet_types, allergens, max_amount_per_meal) VALUES
('Carne de vită (slabă)', '{"vita slaba","vita","carne vita","vita cruda","vita fiarta","vita gratar","steak vita","beef"}', 143, 21, 0, 6, 'meat', '{"omnivore"}', '{}', 250),
('Carne tocată de vită (10%)', '{"vita tocata","tocatura vita","carne tocata vita","burger vita","vita tocata 10"}', 175, 17, 0, 12, 'meat', '{"omnivore"}', '{}', 200),
('Carne tocată de vită (20%)', '{"vita tocata grasa","tocatura grasa","vita tocata 20"}', 235, 17, 0, 18, 'meat', '{"omnivore"}', '{}', 200);

-- ─── CARNE DE PORC (valori CRUDE) ─────────────────────────────────────────────
INSERT INTO foods (name, aliases, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category, diet_types, allergens, max_amount_per_meal) VALUES
('Mușchi de porc', '{"muschi porc","cotlet porc","porc slab","porc gratar","porc la gratar","porc cuptor","porc la cuptor","porc fiert","carne porc"}', 143, 21, 0, 6, 'meat', '{"omnivore"}', '{}', 250);

-- ─── PEȘTE (valori CRUDE; conservele rămân ca atare) ─────────────────────────
INSERT INTO foods (name, aliases, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category, diet_types, allergens, max_amount_per_meal) VALUES
('Somon', '{"somon crud","somon cuptor","somon la cuptor","somon gratar","somon la gratar","somon fillet","somon grill","salmon"}', 208, 20, 0, 13, 'fish', '{"omnivore"}', '{"peste"}', 200),
('Ton (conservă în apă)', '{"ton conserva","ton in apa","ton","tuna"}', 116, 26, 0, 1, 'fish', '{"omnivore"}', '{"peste"}', 185),
('Ton (conservă în ulei)', '{"ton ulei","ton in ulei","tuna in ulei"}', 198, 29, 0, 9, 'fish', '{"omnivore"}', '{"peste"}', 185),
('Cod', '{"cod crud","file cod","cod fiert","cod la cuptor"}', 82, 18, 0, 0.7, 'fish', '{"omnivore"}', '{"peste"}', 200),
('Tilapia', '{"tilapia cruda","tilapia cuptor","tilapia la cuptor"}', 96, 20, 0, 1.7, 'fish', '{"omnivore"}', '{"peste"}', 200),
('Creveți', '{"creveti fierti","creveti cruzi","creveti","shrimp"}', 85, 18, 0.9, 0.5, 'fish', '{"omnivore"}', '{"crustacee","peste"}', 200),
('Sardine (conservă)', '{"sardine conserva","sardine","sardine in apa"}', 208, 25, 0, 11, 'fish', '{"omnivore"}', '{"peste"}', 120),
('Macrou', '{"macrou gratar","macrou crud","macrou la gratar"}', 205, 19, 0, 14, 'fish', '{"omnivore"}', '{"peste"}', 200),
('Păstrăv', '{"pastrav crud","pastrav cuptor","pastrav la cuptor","pastrav"}', 119, 21, 0, 3.5, 'fish', '{"omnivore"}', '{"peste"}', 200),
('Hering (afumat)', '{"hering afumat","hering"}', 217, 24, 0, 13, 'fish', '{"omnivore"}', '{"peste"}', 150),
('Crap', '{"crap fiert","crap crud","crap la cuptor"}', 127, 18, 0, 5.6, 'fish', '{"omnivore"}', '{"peste"}', 250);

-- ─── OUĂ (crud; 1 ou întreg = 60g) ──────────────────────────────────────────
INSERT INTO foods (name, aliases, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category, diet_types, allergens, max_amount_per_meal, grams_per_unit) VALUES
('Ou întreg', '{"ou","oua","ou fiert","oua fierte","ou crud","oua crude","omleta","omleta cu oua","ou omleta","oua omleta","omletă","ou ochi","oua ochi","ochiuri","ou prajit","egg"}', 143, 13, 0.7, 9.5, 'eggs', '{"omnivore","vegetarian"}', '{"oua"}', 180, 60),
('Albuș de ou', '{"albus fiert","albus","albusuri","albus ou","egg white"}', 52, 11, 0.7, 0.2, 'eggs', '{"omnivore","vegetarian"}', '{"oua"}', 240, 30),
('Gălbenuș de ou', '{"galbenus","galbenus ou","egg yolk"}', 322, 16, 3.6, 27, 'eggs', '{"omnivore","vegetarian"}', '{"oua"}', 90, 30);

-- ─── LACTATE ─────────────────────────────────────────────────────────────────
INSERT INTO foods (name, aliases, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category, diet_types, allergens, max_amount_per_meal) VALUES
('Iaurt grecesc (0%)', '{"iaurt grecesc degresat","iaurt 0%","iaurt grec 0"}', 59, 10, 3.6, 0.4, 'dairy', '{"omnivore","vegetarian"}', '{"lactate"}', 300),
('Iaurt grecesc', '{"iaurt grecesc","iaurt grec","iaurt 2%","greek yogurt","iaurt grecesc 2%"}', 97, 9, 3.6, 5, 'dairy', '{"omnivore","vegetarian"}', '{"lactate"}', 300),
('Iaurt grecesc (10%)', '{"iaurt grecesc gras","iaurt 10%","iaurt grec gras"}', 133, 8, 4, 9, 'dairy', '{"omnivore","vegetarian"}', '{"lactate"}', 250),
('Iaurt natural', '{"iaurt natural","iaurt simplu","iaurt","iaurt clasic","iaurt 3.5%"}', 61, 3.5, 4.7, 3.3, 'dairy', '{"omnivore","vegetarian"}', '{"lactate"}', 300),
('Lapte (1.5%)', '{"lapte 1.5","lapte semigresat","lapte semidegresat"}', 47, 3.4, 4.8, 1.5, 'dairy', '{"omnivore","vegetarian"}', '{"lactate"}', 400),
('Lapte (3.5%)', '{"lapte gras","lapte integral","lapte 3.5","lapte"}', 61, 3.2, 4.8, 3.3, 'dairy', '{"omnivore","vegetarian"}', '{"lactate"}', 400),
('Lapte (0%)', '{"lapte degresat","lapte 0%","lapte slab"}', 35, 3.4, 4.9, 0.1, 'dairy', '{"omnivore","vegetarian"}', '{"lactate"}', 400),
('Brânză de vaci', '{"branza vaci","branza proaspata","cottage cheese","branza slaba","branza de vaci slaba","branza de vaci grasa"}', 98, 11, 3.4, 4, 'dairy', '{"omnivore","vegetarian"}', '{"lactate"}', 200),
('Brânză feta', '{"feta","branza feta","telemea"}', 264, 14, 4, 21, 'dairy', '{"omnivore","vegetarian"}', '{"lactate"}', 60),
('Mozzarella', '{"branza mozzarella","mozarella","mozzarella"}', 280, 28, 3, 17, 'dairy', '{"omnivore","vegetarian"}', '{"lactate"}', 60),
('Brânză cheddar', '{"cheddar","branza cheddar"}', 402, 25, 1.3, 33, 'dairy', '{"omnivore","vegetarian"}', '{"lactate"}', 40),
('Brânză ricotta', '{"ricotta","branza ricotta","branza cottage","cottage"}', 174, 11, 3, 13, 'dairy', '{"omnivore","vegetarian"}', '{"lactate"}', 150),
('Parmezan', '{"parmezan","parmesan"}', 431, 38, 4, 29, 'dairy', '{"omnivore","vegetarian"}', '{"lactate"}', 30),
('Smântână (15%)', '{"smantana","smantana 15%","smantana de gatit","sour cream"}', 162, 2.7, 3.4, 15, 'dairy', '{"omnivore","vegetarian"}', '{"lactate"}', 60),
('Smântână (30%)', '{"smantana grasa","smantana 30%","frisca neindulcita"}', 285, 2.1, 3.1, 30, 'dairy', '{"omnivore","vegetarian"}', '{"lactate"}', 40),
('Unt', '{"unt","butter"}', 717, 0.9, 0.1, 81, 'dairy', '{"omnivore","vegetarian"}', '{"lactate"}', 15),
('Chefir', '{"chefir","kefir"}', 55, 3.5, 4, 2, 'dairy', '{"omnivore","vegetarian"}', '{"lactate"}', 300);

-- ─── CEREALE CRUDE (cantități înainte de fierbere) ───────────────────────────
INSERT INTO foods (name, aliases, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category, diet_types, allergens, max_amount_per_meal) VALUES
('Orez alb (crud)', '{"orez","orez alb","orez alb crud","orez fiert","orez alb fiert","rice","white rice"}', 365, 7, 80, 0.7, 'grains', '{"omnivore","vegetarian","vegan"}', '{}', 120),
('Orez brun (crud)', '{"orez brun","orez integral","orez brun crud","orez brun fiert","orez integral fiert","brown rice"}', 370, 8, 77, 2.9, 'grains', '{"omnivore","vegetarian","vegan"}', '{}', 120),
('Orez basmati (crud)', '{"basmati","orez basmati","orez basmati crud","orez basm fiert"}', 360, 8, 78, 0.7, 'grains', '{"omnivore","vegetarian","vegan"}', '{}', 120),
('Paste (crude)', '{"paste","paste fierte","spaghete","spaghete fierte","taietei","pasta"}', 350, 12, 71, 1.5, 'grains', '{"omnivore","vegetarian","vegan"}', '{"gluten"}', 100),
('Paste integrale (crude)', '{"paste integrale","paste integrale fierte","spaghete integrale"}', 350, 14, 69, 2, 'grains', '{"omnivore","vegetarian","vegan"}', '{"gluten"}', 100),
('Penne (crude)', '{"penne","penne fierte"}', 350, 12, 71, 1.5, 'grains', '{"omnivore","vegetarian","vegan"}', '{"gluten"}', 100),
('Fulgi de ovăz', '{"ovaz","fulgi ovaz","oats","fulgi de ovaz","oatmeal","terci ovaz","porridge","terci de ovaz","ovaz gatit"}', 389, 17, 66, 7, 'grains', '{"omnivore","vegetarian","vegan"}', '{"gluten"}', 100),
('Pâine albă', '{"paine alba","paine","toast alb","toast"}', 265, 9, 49, 3.2, 'grains', '{"omnivore","vegetarian","vegan"}', '{"gluten"}', 80),
('Pâine integrală', '{"paine integrala","paine graham","paine neagra","toast integral"}', 247, 9, 41, 3.4, 'grains', '{"omnivore","vegetarian","vegan"}', '{"gluten"}', 80),
('Pâine de secară', '{"paine secara","paine de secara","paine rye"}', 259, 8.5, 48, 3.3, 'grains', '{"omnivore","vegetarian","vegan"}', '{"gluten"}', 80),
('Quinoa (crudă)', '{"quinoa","quinoa cruda","quinoa fiarta","quinoa gatita"}', 368, 14, 64, 6, 'grains', '{"omnivore","vegetarian","vegan"}', '{}', 100),
('Mălai (crud)', '{"malai","mamaliga","mamaliga gatita","polenta","polenta gatita","malai crud"}', 359, 9, 74, 3.5, 'grains', '{"omnivore","vegetarian","vegan"}', '{}', 80),
('Hrișcă (crudă)', '{"hrisca","hrisca cruda","hrisca fiarta","buckwheat"}', 343, 13, 71, 3.4, 'grains', '{"omnivore","vegetarian","vegan"}', '{}', 100),
('Orz (crud)', '{"orz","orz crud","orz fiert","barley"}', 354, 12, 73, 2.3, 'grains', '{"omnivore","vegetarian","vegan"}', '{"gluten"}', 100),
('Couscous (crud)', '{"couscous","couscous crud","couscous fiert","cuscus"}', 376, 13, 77, 0.6, 'grains', '{"omnivore","vegetarian","vegan"}', '{"gluten"}', 100),
('Bulgur (crud)', '{"bulgur","bulgur crud","bulgur fiert"}', 342, 12, 76, 1.3, 'grains', '{"omnivore","vegetarian","vegan"}', '{"gluten"}', 100);

-- ─── CARTOFI (cruzi) ─────────────────────────────────────────────────────────
INSERT INTO foods (name, aliases, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category, diet_types, allergens, max_amount_per_meal) VALUES
('Cartofi', '{"cartofi","cartofi cruzi","cartofi fierti","cartofi albi","cartofi cuptor","cartofi coapti","cartofi la cuptor","piure cartofi","piure de cartofi","piure","potato"}', 77, 2, 17, 0.1, 'starch', '{"omnivore","vegetarian","vegan"}', '{}', 350),
('Cartofi dulci', '{"cartofi dulci","batata","cartofi dulci fierti","cartofi dulci cuptor","batata fiarta","sweet potato"}', 86, 1.6, 20, 0.1, 'starch', '{"omnivore","vegetarian","vegan"}', '{}', 300),
('Cartofi prăjiți', '{"cartofi prajiti","chips","french fries"}', 312, 3.4, 41, 15, 'starch', '{"omnivore","vegetarian","vegan"}', '{}', 150);

-- ─── LEGUMINOASE (gata fierte / din conservă) ───────────────────────────────
INSERT INTO foods (name, aliases, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category, diet_types, allergens, max_amount_per_meal) VALUES
('Năut (fiert/conservă)', '{"naut fiert","naut","chickpeas","naut conserva"}', 164, 9, 27, 2.6, 'legumes', '{"omnivore","vegetarian","vegan"}', '{}', 200),
('Linte roșie (fiartă)', '{"linte fiarta","linte rosie","linte rosie fiarta","linte"}', 116, 9, 20, 0.4, 'legumes', '{"omnivore","vegetarian","vegan"}', '{}', 200),
('Linte verde (fiartă)', '{"linte verde fiarta","linte verde"}', 116, 9, 20, 0.4, 'legumes', '{"omnivore","vegetarian","vegan"}', '{}', 200),
('Fasole roșie (fiartă)', '{"fasole rosie fiarta","fasole rosie","fasole boabe","fasole","fasole alba","fasole alba fiarta"}', 127, 8.7, 23, 0.5, 'legumes', '{"omnivore","vegetarian","vegan"}', '{}', 200),
('Fasole verde (fiartă)', '{"fasole verde fiarta","fasole verde","green beans","pastaie","pastai","fasole pastaie"}', 35, 2, 7, 0.2, 'legumes', '{"omnivore","vegetarian","vegan"}', '{}', 300),
('Mazăre (fiartă/conservă)', '{"mazare fiarta","mazare verde","mazare verde fiarta","mazare","peas","mazare conserva"}', 81, 5.4, 14, 0.4, 'legumes', '{"omnivore","vegetarian","vegan"}', '{}', 200),
('Edamame', '{"edamame","soia fiarta","edamame fierte"}', 122, 11, 8.9, 5.2, 'legumes', '{"omnivore","vegetarian","vegan"}', '{"soia"}', 200),
('Tofu', '{"tofu","tofu ferm","tofu natural","tofu prajit","tofu extra ferm"}', 76, 8, 1.9, 4.2, 'legumes', '{"omnivore","vegetarian","vegan"}', '{"soia"}', 200),
('Hummus', '{"hummus"}', 166, 7.9, 14, 9.6, 'legumes', '{"omnivore","vegetarian","vegan"}', '{"susan"}', 100),
('Tempeh', '{"tempeh"}', 193, 19, 9.4, 11, 'legumes', '{"omnivore","vegetarian","vegan"}', '{"soia"}', 200);

-- ─── LEGUME ──────────────────────────────────────────────────────────────────
INSERT INTO foods (name, aliases, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category, diet_types, allergens, max_amount_per_meal) VALUES
('Broccoli (fiert)', '{"broccoli fiert","broccoli","brocoli"}', 35, 2.4, 7, 0.4, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 300),
('Conopidă (fiartă)', '{"conopida fiarta","conopida"}', 31, 2.5, 5, 0.4, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 300),
('Spanac (fiert)', '{"spanac fiert","spanac","baby spinach fiert"}', 23, 2.9, 3.6, 0.4, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 300),
('Spanac (crud)', '{"spanac crud","spanac proaspat","baby spinach"}', 23, 2.9, 3.6, 0.4, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 200),
('Morcov (crud)', '{"morcov crud","morcov","morcovi","carrot"}', 41, 0.9, 10, 0.2, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 200),
('Morcov (fiert)', '{"morcov fiert","morcovi fierti"}', 35, 0.8, 8, 0.2, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 250),
('Ardei gras (crud)', '{"ardei gras","ardei","ardei gras crud","ardei rosu","ardei galben","ardei verde","bell pepper"}', 31, 1, 6, 0.3, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 200),
('Ardei gras (copt)', '{"ardei copt","ardei gras copt"}', 28, 1, 6, 0.3, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 200),
('Roșii (crude)', '{"rosii","rosie","tomate","tomata","roșii"}', 18, 0.9, 3.9, 0.2, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 300),
('Roșii cherry', '{"rosii cherry","cherry tomatoes"}', 18, 0.9, 3.9, 0.2, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 200),
('Castraveți (cruzi)', '{"castravete","castraveti","castraveti cruzi","cucumber"}', 15, 0.7, 3.6, 0.1, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 300),
('Salată verde (crudă)', '{"salata verde","salata","frunze salata","lettuce","rucola"}', 15, 1.4, 2.9, 0.2, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 200),
('Ceapă (crudă)', '{"ceapa cruda","ceapa","ceapa rosie","ceapa galbena","onion"}', 40, 1.1, 9, 0.1, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 100),
('Ceapă (călită)', '{"ceapa calita","ceapa sotata","ceapa prajita"}', 57, 0.9, 13, 0.2, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 80),
('Ceapă verde', '{"ceapa verde","ceapa de primavara","green onion"}', 32, 1.8, 7.3, 0.2, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 50),
('Dovlecel (fiert)', '{"dovlecel fiert","dovlecel","zucchini","zucchini fiert"}', 17, 1.2, 3.5, 0.2, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 300),
('Dovlecel (la grătar)', '{"dovlecel gratar","zucchini gratar"}', 20, 1.3, 4, 0.3, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 250),
('Vinete (la cuptor)', '{"vinete cuptor","vinete","vinete coapte","eggplant"}', 25, 1, 6, 0.2, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 250),
('Ciuperci (crude)', '{"ciuperci crude","ciuperci","champignon","mushrooms"}', 22, 3.1, 3.3, 0.3, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 200),
('Ciuperci (la tigaie)', '{"ciuperci prajite","ciuperci sotate","ciuperci la tigaie"}', 29, 2.2, 4.4, 0.4, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 200),
('Varză albă (crudă)', '{"varza cruda","varza","varza alba","cabbage"}', 25, 1.3, 5.8, 0.1, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 200),
('Varză roșie (crudă)', '{"varza rosie","varza rosie cruda","red cabbage"}', 31, 1.4, 7, 0.2, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 200),
('Porumb (fiert)', '{"porumb fiert","porumb","porumb dulce","corn"}', 96, 3.4, 21, 1.5, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 200),
('Țelină (crudă)', '{"telina cruda","telina","radacina telina","celeriac"}', 42, 1.5, 9.2, 0.3, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 150),
('Sparanghel (fiert)', '{"sparanghel fiert","sparanghel","asparagus"}', 22, 2.4, 4.1, 0.2, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 200),
('Praz (fiert)', '{"praz fiert","praz","leek"}', 31, 0.8, 7.6, 0.2, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 150),
('Usturoi (crud)', '{"usturoi","usturoi crud","garlic"}', 149, 6.4, 33, 0.5, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 20),
('Gulii', '{"gulii","gulie","kohlrabi"}', 27, 1.7, 6.2, 0.1, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 200),
('Sfeclă roșie (fiartă)', '{"sfecla rosie","sfecla","beet","sfecla fiarta"}', 43, 1.6, 9.6, 0.2, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 200),
('Ridichi', '{"ridichi","radish"}', 16, 0.7, 3.4, 0.1, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 100),
('Nap', '{"nap","turnip"}', 28, 0.9, 6.4, 0.1, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 200),
('Kale (crud)', '{"kale","kale crud","varza kale"}', 49, 4.3, 8.8, 0.9, 'vegetables', '{"omnivore","vegetarian","vegan"}', '{}', 150);

-- ─── FRUCTE ──────────────────────────────────────────────────────────────────
INSERT INTO foods (name, aliases, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category, diet_types, allergens, max_amount_per_meal, grams_per_unit) VALUES
('Banană', '{"banana","banane","banana medie"}', 89, 1.1, 23, 0.3, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 250, 120),
('Măr', '{"mar","mere","apple"}', 52, 0.3, 14, 0.2, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 300, 180),
('Portocală', '{"portocala","portocale","orange"}', 47, 0.9, 12, 0.1, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 300, 150),
('Lămâie', '{"lamaie","lamai","zeama lamaie","lemon"}', 29, 1.1, 9, 0.3, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 100, 100),
('Fructe de pădure (mix)', '{"fructe de padure","berries","mix berries"}', 57, 0.7, 14, 0.3, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 200, NULL),
('Afine', '{"afine","blueberries"}', 57, 0.7, 14, 0.3, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 200, NULL),
('Căpșuni', '{"capsuni","strawberries","capsune"}', 32, 0.7, 7.7, 0.3, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 250, NULL),
('Zmeură', '{"zmeura","raspberries"}', 52, 1.2, 12, 0.7, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 200, NULL),
('Cireșe / Vișine', '{"cirese","ciresele","visine","cherry"}', 50, 1, 12, 0.3, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 200, 10),
('Kiwi', '{"kiwi"}', 61, 1.1, 15, 0.5, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 200, 70),
('Mango', '{"mango"}', 60, 0.8, 15, 0.4, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 250, 250),
('Ananas', '{"ananas","pineapple"}', 50, 0.5, 13, 0.1, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 250, 700),
('Pepene roșu', '{"pepene rosu","pepene","watermelon"}', 30, 0.6, 7.6, 0.2, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 400, NULL),
('Struguri', '{"struguri","grapes"}', 69, 0.7, 18, 0.2, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 200, NULL),
('Pere', '{"para","pere","pear"}', 57, 0.4, 15, 0.1, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 300, 170),
('Piersică', '{"piersica","piersici","nectarina","peach"}', 39, 0.9, 10, 0.3, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 300, 150),
('Prune', '{"pruna","prune","plum"}', 46, 0.7, 11, 0.3, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 200, 50),
('Avocado', '{"avocado"}', 160, 2, 9, 15, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 150, 150),
('Grepfrut', '{"grapefruit","grepfrut"}', 42, 0.8, 11, 0.1, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 300, 230),
('Mandarine', '{"mandarina","mandarine","tangerine"}', 53, 0.8, 13, 0.3, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 250, 80),
('Smochine', '{"smochina","smochine","fig"}', 74, 0.8, 19, 0.3, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 150, 40),
('Curmale', '{"curmalea","curmale","dates"}', 282, 2.5, 75, 0.4, 'fruits', '{"omnivore","vegetarian","vegan"}', '{}', 50, 8);

-- ─── NUCI & SEMINȚE ──────────────────────────────────────────────────────────
INSERT INTO foods (name, aliases, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category, diet_types, allergens, max_amount_per_meal) VALUES
('Migdale', '{"migdale crude","migdale","almonds"}', 579, 21, 22, 50, 'nuts', '{"omnivore","vegetarian","vegan"}', '{"nuci"}', 40),
('Nuci', '{"nuci crude","nuci","walnuts"}', 654, 15, 14, 65, 'nuts', '{"omnivore","vegetarian","vegan"}', '{"nuci"}', 40),
('Caju', '{"caju crud","caju","cashews"}', 553, 18, 30, 44, 'nuts', '{"omnivore","vegetarian","vegan"}', '{"nuci"}', 40),
('Alune de pădure', '{"alune padure","alune","hazelnuts"}', 628, 15, 17, 61, 'nuts', '{"omnivore","vegetarian","vegan"}', '{"nuci"}', 40),
('Arahide', '{"arahide crude","arahide","peanuts","alune americane"}', 567, 26, 16, 49, 'nuts', '{"omnivore","vegetarian","vegan"}', '{"arahide"}', 40),
('Fistic', '{"fistic","pistachios","fistic crud"}', 560, 20, 28, 45, 'nuts', '{"omnivore","vegetarian","vegan"}', '{"nuci"}', 40),
('Semințe de chia', '{"seminte chia","chia","chia seeds"}', 486, 17, 42, 31, 'nuts', '{"omnivore","vegetarian","vegan"}', '{}', 30),
('Semințe de in', '{"seminte in","in","flaxseeds","seminte de in"}', 534, 18, 29, 42, 'nuts', '{"omnivore","vegetarian","vegan"}', '{}', 30),
('Semințe de dovleac', '{"seminte dovleac","seminte de dovleac","pumpkin seeds"}', 559, 30, 11, 49, 'nuts', '{"omnivore","vegetarian","vegan"}', '{}', 30),
('Semințe de floarea soarelui', '{"seminte floarea soarelui","seminte floarea-soarelui","sunflower seeds"}', 584, 21, 20, 51, 'nuts', '{"omnivore","vegetarian","vegan"}', '{}', 30),
('Semințe de susan', '{"susan","seminte susan","sesame","susan negru"}', 573, 18, 23, 50, 'nuts', '{"omnivore","vegetarian","vegan"}', '{"susan"}', 20),
('Unt de arahide', '{"unt arahide","unt de arahide","peanut butter"}', 588, 25, 20, 50, 'nuts', '{"omnivore","vegetarian","vegan"}', '{"arahide"}', 30),
('Tahini', '{"tahini","pasta susan"}', 595, 17, 21, 54, 'nuts', '{"omnivore","vegetarian","vegan"}', '{"susan"}', 20);

-- ─── ULEIURI & GRĂSIMI ───────────────────────────────────────────────────────
INSERT INTO foods (name, aliases, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category, diet_types, allergens, max_amount_per_meal) VALUES
('Ulei de măsline', '{"ulei masline","ulei de masline","olive oil","ulei"}', 884, 0, 0, 100, 'fats', '{"omnivore","vegetarian","vegan"}', '{}', 20),
('Ulei de cocos', '{"ulei cocos","ulei de cocos","coconut oil"}', 892, 0, 0, 99, 'fats', '{"omnivore","vegetarian","vegan"}', '{}', 15),
('Ulei de floarea soarelui', '{"ulei floarea soarelui","ulei vegetal","sunflower oil"}', 884, 0, 0, 100, 'fats', '{"omnivore","vegetarian","vegan"}', '{}', 20),
('Ulei de avocado', '{"ulei avocado","avocado oil"}', 884, 0, 0, 100, 'fats', '{"omnivore","vegetarian","vegan"}', '{}', 20);

-- ─── CONDIMENTE & ALTELE ─────────────────────────────────────────────────────
INSERT INTO foods (name, aliases, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, category, diet_types, allergens, max_amount_per_meal) VALUES
('Miere', '{"miere de albine","miere","honey"}', 304, 0.3, 82, 0, 'other', '{"omnivore","vegetarian"}', '{}', 20),
('Sirop de arțar', '{"sirop artar","maple syrup"}', 260, 0, 67, 0.1, 'other', '{"omnivore","vegetarian","vegan"}', '{}', 20),
('Zahăr', '{"zahar","zahar alb","sugar"}', 387, 0, 100, 0, 'other', '{"omnivore","vegetarian","vegan"}', '{}', 20),
('Pudră de cacao', '{"cacao","cacao praf","pudra cacao","cocoa powder"}', 228, 19, 58, 14, 'other', '{"omnivore","vegetarian","vegan"}', '{}', 20),
('Pudră de proteine', '{"proteina praf","zer proteic","whey protein","protein powder","pudra proteine","shake proteic"}', 400, 80, 8, 5, 'other', '{"omnivore","vegetarian"}', '{"lactate"}', 40),
('Mustar', '{"mustar","mustard"}', 60, 3.7, 5.8, 3.3, 'other', '{"omnivore","vegetarian","vegan"}', '{}', 20),
('Sos de soia', '{"sos soia","soy sauce","tamari"}', 53, 8.1, 4.9, 0.1, 'other', '{"omnivore","vegetarian","vegan"}', '{"soia","gluten"}', 20),
('Oțet balsamic', '{"otet balsamic","balsamic"}', 88, 0.5, 17, 0, 'other', '{"omnivore","vegetarian","vegan"}', '{}', 20),
('Dressing de iaurt', '{"dressing iaurt","sos iaurt","iaurt dressing"}', 90, 2, 8, 5, 'other', '{"omnivore","vegetarian"}', '{"lactate"}', 50);

-- ═══════════════════════════════════════════════════════════════════════════════
-- FUNCȚII UTILE
-- ═══════════════════════════════════════════════════════════════════════════════

-- Funcție pentru a obține alimentele filtrate după tipul de dietă
CREATE OR REPLACE FUNCTION get_foods_for_diet(diet_type TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  calories_per_100g NUMERIC,
  protein_per_100g NUMERIC,
  carbs_per_100g NUMERIC,
  fat_per_100g NUMERIC,
  category TEXT,
  max_amount_per_meal NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    f.id,
    f.name,
    f.calories_per_100g,
    f.protein_per_100g,
    f.carbs_per_100g,
    f.fat_per_100g,
    f.category,
    f.max_amount_per_meal
  FROM foods f
  WHERE f.is_active = TRUE
    AND diet_type = ANY(f.diet_types);
END;
$$ LANGUAGE plpgsql;

-- Funcție pentru a obține alimentele filtrate după alergii (exclude alimentele cu alergenii specificați)
CREATE OR REPLACE FUNCTION get_foods_excluding_allergens(allergen_list TEXT[])
RETURNS TABLE (
  id UUID,
  name TEXT,
  calories_per_100g NUMERIC,
  protein_per_100g NUMERIC,
  carbs_per_100g NUMERIC,
  fat_per_100g NUMERIC,
  category TEXT,
  max_amount_per_meal NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    f.id,
    f.name,
    f.calories_per_100g,
    f.protein_per_100g,
    f.carbs_per_100g,
    f.fat_per_100g,
    f.category,
    f.max_amount_per_meal
  FROM foods f
  WHERE f.is_active = TRUE
    AND NOT (f.allergens && allergen_list);
END;
$$ LANGUAGE plpgsql;
