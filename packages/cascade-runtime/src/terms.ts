const CASCADE = "https://ns.cascadeprotocol.org/cascade#";

/**
 * The vocabulary's IRIs an app names, each under the local name the term takes in the vocabulary's one namespace, so
 * an app reads the same keys whatever names the vocabulary the runtime carries gives its terms. Served from
 * `cascade-runtime/terms` with nothing of the runtime behind it, and from each entry.
 */
export const terms = Object.freeze({
  MedicationActive: `${CASCADE}MedicationActive`,
  MedicationPaused: `${CASCADE}MedicationPaused`,
  MedicationUnknown: `${CASCADE}MedicationUnknown`,
  MedicationStopped: `${CASCADE}MedicationStopped`,
  MedicationEnteredInError: `${CASCADE}MedicationEnteredInError`,

  Pathogenic: `${CASCADE}Pathogenic`,
  LikelyPathogenic: `${CASCADE}LikelyPathogenic`,
  UncertainSignificance: `${CASCADE}UncertainSignificance`,
  LikelyBenign: `${CASCADE}LikelyBenign`,
  Benign: `${CASCADE}Benign`,

  ClinVarConflicting: `${CASCADE}ClinVarConflicting`,
  ClinVarConflictingData: `${CASCADE}ClinVarConflictingData`,
  ClinVarCombinationOnly: `${CASCADE}ClinVarCombinationOnly`,
  ClinVarVusHigh: `${CASCADE}ClinVarVusHigh`,
  ClinVarRiskFactor: `${CASCADE}ClinVarRiskFactor`,
  ClinVarMultipleSubmittersNoConflicts: `${CASCADE}ClinVarMultipleSubmittersNoConflicts`,
  ClinVarSingleSubmitter: `${CASCADE}ClinVarSingleSubmitter`,
  ClinVarNoAssertionCriteria: `${CASCADE}ClinVarNoAssertionCriteria`,

  establishedPharmacologicClass: `${CASCADE}establishedPharmacologicClass`,
  mechanismOfActionClass: `${CASCADE}mechanismOfActionClass`,
  physiologicEffectClass: `${CASCADE}physiologicEffectClass`,
  chemicalStructureClass: `${CASCADE}chemicalStructureClass`,

  mergedFrom: `${CASCADE}mergedFrom`,
  hgvsCodingDnaExpression: `${CASCADE}hgvsCodingDnaExpression`,
  clinvarVariationId: `${CASCADE}clinvarVariationId`,
  geneSymbol: `${CASCADE}geneSymbol`,
  coversGene: `${CASCADE}coversGene`,
  clinvarClassification: `${CASCADE}clinvarClassification`,
  clinvarReviewStatus: `${CASCADE}clinvarReviewStatus`,
  contributingSubmitterCount: `${CASCADE}contributingSubmitterCount`,
  variantInterpreted: `${CASCADE}variantInterpreted`,
  acmgClassification: `${CASCADE}acmgClassification`,
  interpretedDate: `${CASCADE}interpretedDate`,

  drugName: `${CASCADE}drugName`,
  medicationUseEndDate: `${CASCADE}medicationUseEndDate`,
  allergen: `${CASCADE}allergen`,
  Vaccination: `${CASCADE}Vaccination`,
  vaccineCode: `${CASCADE}vaccineCode`,
  vaccinationOccurrenceTime: `${CASCADE}vaccinationOccurrenceTime`,

  patient: `${CASCADE}patient`,
  PatientRole: `${CASCADE}PatientRole`,
  justification: `${CASCADE}justification`,
  SameMappedCodeAndDate: `${CASCADE}SameMappedCodeAndDate`,

  CodeSystem: `${CASCADE}CodeSystem`,
  ReferenceSeries: `${CASCADE}ReferenceSeries`,
  defaultTableVersion: `${CASCADE}defaultTableVersion`,

  /** The property a version of each kind states its status by, under the kind's class. */
  statusOf: Object.freeze({
    AllergyOrIntolerance: `${CASCADE}clinicalStatus`,
    ProblemOrDiagnosis: `${CASCADE}clinicalStatus`,
    Vaccination: `${CASCADE}workflowStatus`,
    PrescribedOrReportedMedication: `${CASCADE}workflowStatus`,
    MedicalProcedure: `${CASCADE}workflowStatus`,
    LaboratoryTestResult: `${CASCADE}workflowStatus`,
  }),
});

export type Terms = typeof terms;

/**
 * Each code system's IRI stem, its `void:uriSpace`, under the system's local name: a code's IRI is its stem followed by
 * the code percent-encoded as SPARQL's ENCODE_FOR_URI does.
 */
export const codeStems = Object.freeze({
  CVX: "https://ns.cascadeprotocol.org/codes/cvx/",
  RxNorm: "https://ns.cascadeprotocol.org/codes/rxnorm/",
  NDC: "https://ns.cascadeprotocol.org/codes/ndc11/",
  ICD10CM: "https://ns.cascadeprotocol.org/codes/icd10cm/",
  SNOMEDCT: "http://snomed.info/id/",
  LOINC: "http://loinc.org/rdf/",
  MEDRT: "https://ns.cascadeprotocol.org/codes/medrt/",
  MeSH: "http://id.nlm.nih.gov/mesh/",
  UNII: "https://identifiers.org/unii:",
  CPT: "https://ns.cascadeprotocol.org/codes/cpt/",
  ICD9CM: "https://ns.cascadeprotocol.org/codes/icd9cm/",
  HGVS: "https://ns.cascadeprotocol.org/codes/hgvs/",
  ClinVar: "https://identifiers.org/clinvar:",
  DataAbsentReason: "https://ns.cascadeprotocol.org/codes/data-absent-reason/",
  NullFlavor: "https://ns.cascadeprotocol.org/codes/nullflavor/",
  ObservationInterpretation:
    "https://ns.cascadeprotocol.org/codes/observation-interpretation/",
});

export type CodeStems = typeof codeStems;
