const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
const GENOMICS = "https://ns.cascadeprotocol.org/genomics/v1#";
const CORE = "https://ns.cascadeprotocol.org/core/v1#";
const CLINICAL = "https://ns.cascadeprotocol.org/clinical/v1#";
const HEALTH = "https://ns.cascadeprotocol.org/health/v1#";
const JDG = "https://ns.cascadeprotocol.org/judgments/v1-draft#";

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
  UncertainSignificance: `${GENOMICS}VUS`,
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
  mechanismOfActionClass: `${REC}mechanismOfAction`,
  physiologicEffectClass: `${REC}physiologicEffect`,
  chemicalStructureClass: `${REC}chemicalStructure`,

  mergedFrom: `${CORE}mergedFrom`,
  hgvsCodingDnaExpression: `${GENOMICS}hgvsCDot`,
  clinvarVariationId: `${GENOMICS}clinvarVariationId`,
  geneSymbol: `${GENOMICS}geneSymbol`,
  coversGene: `${REC}coversGene`,
  clinvarClassification: `${REC}clinvarClassification`,
  clinvarReviewStatus: `${REC}clinvarReviewStatus`,
  contributingSubmitterCount: `${REC}contributingSubmitters`,
  variantInterpreted: `${GENOMICS}variantInterpreted`,
  acmgClassification: `${GENOMICS}acmgClassification`,
  interpretedDate: `${GENOMICS}interpretedDate`,

  drugName: `${CLINICAL}drugName`,
  medicationUseEndDate: `${CLINICAL}endDate`,
  allergen: `${HEALTH}allergen`,
  Vaccination: `${HEALTH}ImmunizationRecord`,
  vaccineCode: `${HEALTH}vaccineCode`,
  vaccinationOccurrenceTime: `${HEALTH}administrationDate`,

  patient: `${REC}patient`,
  PatientRole: `${JDG}patient`,
  justification: `${JDG}justification`,
  SameMappedCodeAndDate: `${JDG}SameMappedCodeAndDate`,

  CodeSystem: `${REC}CodeSystem`,
  ReferenceSeries: `${REC}ReferenceSeries`,
  defaultTableVersion: `${REC}shipsWith`,

  /** The property a version of each kind states its status by, under the kind's class. */
  statusOf: Object.freeze({
    AllergyOrIntolerance: `${CLINICAL}status`,
    ProblemOrDiagnosis: `${HEALTH}status`,
    Vaccination: `${HEALTH}status`,
    PrescribedOrReportedMedication: `${CLINICAL}status`,
    MedicalProcedure: `${CLINICAL}status`,
    LaboratoryTestResult: `${CLINICAL}status`,
  }),
});

export type Terms = typeof terms;
