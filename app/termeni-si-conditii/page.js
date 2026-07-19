import LegalPage from '@/app/components/LegalPage';

export const metadata = {
  title: 'Termeni și condiții',
  description: 'Termenii de utilizare pentru Trevano, aplicația B2C de nutriție și antrenament.',
  alternates: {
    canonical: '/termeni-si-conditii',
  },
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="TERMENI ȘI CONDIȚII DE UTILIZARE"
      meta={[
        'Ultima actualizare: 19.07.2026',
      ]}
      sections={[
        {
          title: '1. Introducere',
          body: [
            'Prezentul document stabilește Termenii și Condițiile de utilizare a aplicației și website-ului Trevano ("Trevano", "Aplicația", "Serviciul").',
            'Prin crearea unui cont sau utilizarea aplicației confirmi că ai citit, ai înțeles și accepți integral acești Termeni și Condiții.',
            'Dacă nu ești de acord cu aceștia, te rugăm să nu utilizezi aplicația.',
            'Operatorul serviciului este:',
            'ANDREICA GABRIEL-Ioan PFA',
            'CUI: 46589606',
            'Website: https://trevano.app',
          ],
        },
        {
          title: '2. Descrierea serviciului',
          body: [
            'Trevano este o aplicație destinată persoanelor care doresc să își îmbunătățească stilul de viață prin alimentație și activitate fizică.',
            'Aplicația poate oferi, fără a se limita la:',
          ],
          items: [
            'planuri personalizate de alimentație;',
            'planuri personalizate de antrenament;',
            'obiective privind greutatea corporală;',
            'misiuni zilnice;',
            'urmărirea progresului;',
            'check-in-uri periodice;',
            'recomandări automate;',
            'ajustarea planurilor în funcție de progres;',
            'funcționalități premium disponibile prin abonament.',
          ],
          after: [
            'Ne rezervăm dreptul de a modifica, adăuga sau elimina funcționalități fără notificare prealabilă.',
          ],
        },
        {
          title: '3. Contul de utilizator',
          body: [
            'Pentru utilizarea anumitor funcționalități este necesară crearea unui cont.',
            'Utilizatorul este responsabil pentru:',
          ],
          items: [
            'corectitudinea informațiilor introduse;',
            'păstrarea confidențialității parolei;',
            'toate activitățile desfășurate prin contul său.',
          ],
          after: [
            'Ne rezervăm dreptul de a suspenda sau închide conturile utilizate fraudulos, abuziv sau cu încălcarea prezentelor condiții.',
          ],
        },
        {
          title: '4. Eligibilitate',
          body: [
            'Prin utilizarea aplicației declari că:',
          ],
          items: [
            'ai cel puțin 18 ani sau utilizezi aplicația cu acordul părintelui ori tutorelui legal;',
            'ai capacitatea legală de a accepta acești Termeni și Condiții;',
            'informațiile introduse sunt reale și actualizate.',
          ],
        },
        {
          title: '5. Abonamente și plăți',
          body: [
            'Trevano poate pune la dispoziție atât un plan gratuit, cât și unul sau mai multe abonamente premium.',
            'Funcționalitățile disponibile diferă în funcție de tipul abonamentului activ.',
            'Plățile sunt procesate prin intermediul unui procesator de plăți autorizat.',
            'Abonamentele se reînnoiesc automat până la anularea acestora.',
            'Utilizatorul poate anula abonamentul în orice moment, iar acesta va rămâne activ până la sfârșitul perioadei deja achitate.',
            'Cu excepția situațiilor prevăzute de lege, plățile efectuate nu sunt rambursabile.',
          ],
        },
        {
          title: '6. Utilizarea aplicației',
          body: [
            'Utilizatorul se obligă să utilizeze aplicația exclusiv în scopuri legale.',
            'Este interzisă:',
          ],
          items: [
            'utilizarea aplicației în scopuri frauduloase;',
            'încercarea de acces neautorizat la infrastructura Trevano;',
            'copierea, modificarea sau distribuirea aplicației fără acordul operatorului;',
            'utilizarea de programe automate, scripturi sau alte metode care afectează funcționarea serviciului;',
            'revânzarea sau redistribuirea serviciului.',
          ],
        },
        {
          title: '7. Recomandări privind sănătatea',
          body: [
            'Trevano este o aplicație destinată susținerii unui stil de viață sănătos.',
            'Aplicația NU reprezintă un dispozitiv medical și NU oferă servicii medicale.',
            'Planurile alimentare, planurile de antrenament, recomandările, analizele progresului, ajustările automate și orice alte informații furnizate prin aplicație au exclusiv caracter informativ și educațional.',
            'Acestea:',
          ],
          items: [
            'nu reprezintă recomandări medicale;',
            'nu constituie diagnostic medical;',
            'nu reprezintă tratament;',
            'nu înlocuiesc consultația unui medic, dietetician, nutriționist, kinetoterapeut sau antrenor autorizat.',
          ],
        },
        {
          title: '8. Consultarea unui medic',
          body: [
            'Dacă suferi de afecțiuni medicale, urmezi un tratament, ești însărcinată, ai fost supus unei intervenții chirurgicale recente sau ai orice nelămurire privind starea ta de sănătate, îți recomandăm să consulți un medic înainte de a urma recomandările oferite de Trevano.',
            'Dacă în timpul efectuării exercițiilor apar dureri, amețeli, dificultăți respiratorii sau orice alt simptom neobișnuit, trebuie să întrerupi imediat activitatea și să consulți un medic.',
          ],
        },
        {
          title: '9. Limitarea răspunderii',
          body: [
            'Utilizarea aplicației se face exclusiv pe propria răspundere.',
            'În limita maximă permisă de lege, operatorul Trevano nu răspunde pentru:',
          ],
          items: [
            'accidentări;',
            'întinderi sau rupturi musculare;',
            'entorse;',
            'luxații;',
            'fracturi;',
            'reacții alergice;',
            'intoleranțe alimentare;',
            'agravarea unor afecțiuni existente;',
            'complicații medicale;',
            'pierderea sau creșterea în greutate;',
            'lipsa rezultatelor dorite;',
            'utilizarea necorespunzătoare a recomandărilor generate de aplicație;',
            'orice prejudicii directe sau indirecte rezultate din utilizarea serviciului.',
          ],
          after: [
            'Rezultatele diferă de la persoană la persoană și depind de numeroși factori, inclusiv starea de sănătate, genetica, consecvența, alimentația, odihna și activitatea fizică.',
            'Operatorul nu garantează atingerea unui anumit obiectiv de greutate, compoziție corporală sau performanță fizică.',
          ],
        },
        {
          title: '10. Exactitatea informațiilor',
          body: [
            'Calitatea recomandărilor generate de Trevano depinde de informațiile introduse de utilizator.',
            'Introducerea unor date incorecte, incomplete sau neactualizate poate conduce la recomandări nepotrivite.',
            'Utilizatorul este singurul responsabil pentru corectitudinea datelor furnizate.',
          ],
        },
        {
          title: '11. Proprietate intelectuală',
          body: [
            'Întregul conținut al aplicației, inclusiv, fără limitare:',
          ],
          items: [
            'codul sursă;',
            'designul;',
            'interfața;',
            'elementele grafice;',
            'textele;',
            'logo-ul;',
            'funcționalitățile;',
          ],
          after: [
            'reprezintă proprietatea operatorului sau a licențiatorilor acestuia și este protejat de legislația privind drepturile de autor.',
            'Este interzisă copierea, reproducerea, distribuirea sau utilizarea acestora fără acordul prealabil scris.',
          ],
        },
        {
          title: '12. Disponibilitatea serviciului',
          body: [
            'Depunem toate eforturile pentru a menține serviciul funcțional și disponibil.',
            'Cu toate acestea, nu garantăm funcționarea neîntreruptă, lipsa erorilor sau disponibilitatea permanentă a aplicației.',
            'Putem suspenda temporar accesul pentru:',
          ],
          items: [
            'mentenanță;',
            'actualizări;',
            'remedieri tehnice;',
            'îmbunătățirea serviciului.',
          ],
        },
        {
          title: '13. Suspendarea sau încetarea contului',
          body: [
            'Ne rezervăm dreptul de a suspenda sau închide conturile utilizatorilor care:',
          ],
          items: [
            'încalcă acești Termeni și Condiții;',
            'utilizează aplicația în mod fraudulos;',
            'afectează securitatea sau funcționarea serviciului;',
            'încearcă să exploateze vulnerabilități ale aplicației;',
            'aduc prejudicii operatorului sau altor utilizatori.',
          ],
        },
        {
          title: '14. Modificarea serviciului',
          body: [
            'Ne rezervăm dreptul de a modifica, suspenda sau elimina funcționalități ale aplicației, precum și structura abonamentelor și a serviciilor oferite.',
          ],
        },
        {
          title: '15. Modificarea Termenilor și Condițiilor',
          body: [
            'Putem modifica periodic acești Termeni și Condiții.',
            'Versiunea actualizată va fi publicată pe website și va produce efecte de la data publicării.',
            'Continuarea utilizării aplicației după publicarea modificărilor reprezintă acceptarea noii versiuni.',
          ],
        },
        {
          title: '16. Legea aplicabilă',
          body: [
            'Acești Termeni și Condiții sunt guvernați de legislația din România.',
            'Orice litigiu va fi soluționat de instanțele competente din România.',
          ],
        },
        {
          title: '17. Contact',
          body: [
            'Operator:',
            'ANDREICA GABRIEL-Ioan PFA',
            'CUI: 46589606',
            'Website: https://trevano.app',
          ],
        },
      ]}
    />
  );
}
