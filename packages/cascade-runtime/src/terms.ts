const REC = "https://ns.cascadeprotocol.org/cascade#";
const GENOMICS = "https://ns.cascadeprotocol.org/cascade#";
const CORE = "https://ns.cascadeprotocol.org/cascade#";
const CLINICAL = "https://ns.cascadeprotocol.org/cascade#";
const HEALTH = "https://ns.cascadeprotocol.org/cascade#";
const JDG = "https://ns.cascadeprotocol.org/cascade#";

/**
 * The vocabulary's IRIs an app names, each under the local name the term takes in the vocabulary's one namespace, so
 * an app reads the same keys whatever names the vocabulary the runtime carries gives its terms. Served from
 * `cascade-runtime/terms` with nothing of the runtime behind it, and from each entry.
 */
export const terms = Object.freeze({
  MedicationActive: `${REC}MedicationActive`,
  MedicationPaused: `${REC}MedicationPaused`,
  MedicationUnknown: `${REC}MedicationUnknown`,
  MedicationStopped: `${REC}MedicationStopped`,
  MedicationEnteredInError: `${REC}MedicationEnteredInError`,

  Pathogenic: `${GENOMICS}Pathogenic`,
  LikelyPathogenic: `${GENOMICS}LikelyPathogenic`,
  UncertainSignificance: `${GENOMICS}UncertainSignificance`,
  LikelyBenign: `${GENOMICS}LikelyBenign`,
  Benign: `${GENOMICS}Benign`,

  ClinVarConflicting: `${REC}ClinVarConflicting`,
  ClinVarConflictingData: `${REC}ClinVarConflictingData`,
  ClinVarCombinationOnly: `${REC}ClinVarCombinationOnly`,
  ClinVarVusHigh: `${REC}ClinVarVusHigh`,
  ClinVarRiskFactor: `${REC}ClinVarRiskFactor`,
  ClinVarMultipleSubmittersNoConflicts: `${REC}ClinVarMultipleSubmittersNoConflicts`,
  ClinVarSingleSubmitter: `${REC}ClinVarSingleSubmitter`,
  ClinVarNoAssertionCriteria: `${REC}ClinVarNoAssertionCriteria`,

  establishedPharmacologicClass: `${REC}establishedPharmacologicClass`,
  mechanismOfActionClass: `${REC}mechanismOfActionClass`,
  physiologicEffectClass: `${REC}physiologicEffectClass`,
  chemicalStructureClass: `${REC}chemicalStructureClass`,

  mergedFrom: `${CORE}mergedFrom`,
  hgvsCodingDnaExpression: `${GENOMICS}hgvsCodingDnaExpression`,
  clinvarVariationId: `${GENOMICS}clinvarVariationId`,
  geneSymbol: `${GENOMICS}geneSymbol`,
  coversGene: `${REC}coversGene`,
  clinvarClassification: `${REC}clinvarClassification`,
  clinvarReviewStatus: `${REC}clinvarReviewStatus`,
  contributingSubmitterCount: `${REC}contributingSubmitterCount`,
  variantInterpreted: `${GENOMICS}variantInterpreted`,
  acmgClassification: `${GENOMICS}acmgClassification`,
  interpretedDate: `${GENOMICS}interpretedDate`,

  drugName: `${CLINICAL}drugName`,
  medicationUseEndDate: `${CLINICAL}medicationUseEndDate`,
  allergen: `${HEALTH}allergen`,
  Vaccination: `${HEALTH}Vaccination`,
  vaccineCode: `${HEALTH}vaccineCode`,
  vaccinationOccurrenceTime: `${HEALTH}vaccinationOccurrenceTime`,

  patient: `${REC}patient`,
  PatientRole: `${JDG}PatientRole`,
  justification: `${JDG}justification`,
  SameMappedCodeAndDate: `${JDG}SameMappedCodeAndDate`,

  CodeSystem: `${REC}CodeSystem`,
  ReferenceSeries: `${REC}ReferenceSeries`,
  defaultTableVersion: `${REC}defaultTableVersion`,

  /** The property a version of each kind states its status by, under the kind's class. */
  statusOf: Object.freeze({
    AllergyOrIntolerance: `${CLINICAL}clinicalStatus`,
    ProblemOrDiagnosis: `${HEALTH}clinicalStatus`,
    Vaccination: `${HEALTH}workflowStatus`,
    PrescribedOrReportedMedication: `${CLINICAL}workflowStatus`,
    MedicalProcedure: `${CLINICAL}workflowStatus`,
    LaboratoryTestResult: `${CLINICAL}workflowStatus`,
  }),
});

export type Terms = typeof terms;
