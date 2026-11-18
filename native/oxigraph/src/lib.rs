//! Oxigraph's in-memory store for Node, in the shape of the `oxigraph` package's JavaScript build: the same options
//! objects, and terms as RDF/JS plain objects.

use napi::bindgen_prelude::{Either, Uint8Array};
use napi::{Error, Result};
use napi_derive::napi;
use oxigraph::io::{RdfFormat, RdfParser, RdfSerializer};
use oxigraph::model::{
    BaseDirection, BlankNode, GraphName, Literal, NamedNode, NamedOrBlankNode, Quad, Term, TermRef,
};
use oxigraph::sparql::results::{QueryResultsFormat, QueryResultsSerializer};
use oxigraph::sparql::{QueryResults, SparqlEvaluator};

const XSD_STRING: &str = "http://www.w3.org/2001/XMLSchema#string";
const RDF_LANG_STRING: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString";
const RDF_DIR_LANG_STRING: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#dirLangString";

fn failed(error: impl std::fmt::Display) -> Error {
    Error::from_reason(error.to_string())
}

/// The version of the oxigraph crate this was built with, as Cargo.lock names it.
#[napi]
pub fn oxigraph_version() -> String {
    env!("OXIGRAPH_VERSION").to_owned()
}

#[cfg(feature = "panic-probe")]
#[napi]
pub fn panics() {
    panic!("a panic in the binding");
}

#[napi(object)]
pub struct JsNamedNode {
    pub term_type: String,
    pub value: String,
}

/// An RDF/JS term: a NamedNode, BlankNode, Literal or DefaultGraph. A literal's direction is RDF 1.2's, as the
/// WebAssembly build gives it: `ltr`, `rtl`, or empty.
#[napi(object)]
pub struct JsTerm {
    pub term_type: String,
    pub value: String,
    pub language: Option<String>,
    pub direction: Option<String>,
    pub datatype: Option<JsNamedNode>,
}

#[napi(object)]
pub struct JsQuad {
    pub subject: JsTerm,
    pub predicate: JsTerm,
    pub object: JsTerm,
    pub graph: Option<JsTerm>,
}

enum Read {
    Term(Term),
    DefaultGraph,
}

fn read(term: &JsTerm) -> Result<Read> {
    Ok(Read::Term(match term.term_type.as_str() {
        "NamedNode" => NamedNode::new(&term.value).map_err(failed)?.into(),
        "BlankNode" => BlankNode::new(&term.value).map_err(failed)?.into(),
        "Literal" => {
            let language = term
                .language
                .as_deref()
                .filter(|language| !language.is_empty());
            let datatype = term
                .datatype
                .as_ref()
                .map(|datatype| datatype.value.as_str());
            let direction = match term.direction.as_deref().unwrap_or_default() {
                "" => None,
                "ltr" => Some(BaseDirection::Ltr),
                "rtl" => Some(BaseDirection::Rtl),
                other => return Err(failed(format!("Invalid direction: {other}"))),
            };
            match (datatype, language) {
                (None | Some(RDF_DIR_LANG_STRING), Some(language)) if direction.is_some() => {
                    Literal::new_directional_language_tagged_literal(
                        &term.value,
                        language,
                        direction.unwrap_or(BaseDirection::Ltr),
                    )
                    .map_err(failed)?
                    .into()
                }
                (None | Some(RDF_LANG_STRING), Some(language)) => {
                    Literal::new_language_tagged_literal(&term.value, language)
                        .map_err(failed)?
                        .into()
                }
                (None | Some(XSD_STRING), None) => Literal::new_simple_literal(&term.value).into(),
                (Some(RDF_LANG_STRING | RDF_DIR_LANG_STRING), _) => {
                    return Err(failed(
                        "a literal of rdf:langString has a language, and of rdf:dirLangString a direction too",
                    ));
                }
                (Some(datatype), _) => Literal::new_typed_literal(
                    &term.value,
                    NamedNode::new(datatype).map_err(failed)?,
                )
                .into(),
            }
        }
        "DefaultGraph" => return Ok(Read::DefaultGraph),
        other => return Err(failed(format!("a term of type {other} is not read here"))),
    }))
}

fn subject(term: &JsTerm) -> Result<NamedOrBlankNode> {
    match read(term)? {
        Read::Term(Term::NamedNode(node)) => Ok(node.into()),
        Read::Term(Term::BlankNode(node)) => Ok(node.into()),
        _ => Err(failed("a subject is a NamedNode or a BlankNode")),
    }
}

fn named(term: &JsTerm) -> Result<NamedNode> {
    match read(term)? {
        Read::Term(Term::NamedNode(node)) => Ok(node),
        _ => Err(failed("a predicate is a NamedNode")),
    }
}

fn object(term: &JsTerm) -> Result<Term> {
    match read(term)? {
        Read::Term(term) => Ok(term),
        Read::DefaultGraph => Err(failed("an object is no DefaultGraph")),
    }
}

fn graph(term: Option<&JsTerm>) -> Result<GraphName> {
    let Some(term) = term else {
        return Ok(GraphName::DefaultGraph);
    };
    match read(term)? {
        Read::DefaultGraph => Ok(GraphName::DefaultGraph),
        Read::Term(Term::NamedNode(node)) => Ok(node.into()),
        Read::Term(Term::BlankNode(node)) => Ok(node.into()),
        Read::Term(_) => Err(failed(
            "a graph is a NamedNode, a BlankNode or the DefaultGraph",
        )),
    }
}

fn quad(quad: &JsQuad) -> Result<Quad> {
    Ok(Quad::new(
        subject(&quad.subject)?,
        named(&quad.predicate)?,
        object(&quad.object)?,
        graph(quad.graph.as_ref())?,
    ))
}

fn plain(term_type: &str, value: &str) -> JsTerm {
    JsTerm {
        term_type: term_type.into(),
        value: value.into(),
        language: None,
        direction: None,
        datatype: None,
    }
}

fn term_of(term: TermRef<'_>) -> Result<JsTerm> {
    Ok(match term {
        TermRef::NamedNode(node) => plain("NamedNode", node.as_str()),
        TermRef::BlankNode(node) => plain("BlankNode", node.as_str()),
        TermRef::Literal(literal) => JsTerm {
            term_type: "Literal".into(),
            value: literal.value().into(),
            language: Some(literal.language().unwrap_or_default().into()),
            direction: Some(
                match literal.direction() {
                    Some(BaseDirection::Ltr) => "ltr",
                    Some(BaseDirection::Rtl) => "rtl",
                    None => "",
                }
                .into(),
            ),
            datatype: Some(JsNamedNode {
                term_type: "NamedNode".into(),
                value: literal.datatype().as_str().into(),
            }),
        },
        TermRef::Triple(_) => return Err(failed("an RDF 1.2 triple term is not given here")),
    })
}

fn graph_of(graph: &GraphName) -> JsTerm {
    match graph {
        GraphName::NamedNode(node) => plain("NamedNode", node.as_str()),
        GraphName::BlankNode(node) => plain("BlankNode", node.as_str()),
        GraphName::DefaultGraph => plain("DefaultGraph", ""),
    }
}

fn quad_of(quad: &Quad) -> Result<JsQuad> {
    Ok(JsQuad {
        subject: term_of(quad.subject.as_ref().into())?,
        predicate: term_of(quad.predicate.as_ref().into())?,
        object: term_of(quad.object.as_ref())?,
        graph: Some(graph_of(&quad.graph_name)),
    })
}

/// The evaluator with GeoSPARQL's functions, as the WebAssembly build's.
fn evaluator() -> SparqlEvaluator {
    let mut evaluator = SparqlEvaluator::new();
    for (name, implementation) in spargeo::GEOSPARQL_EXTENSION_FUNCTIONS {
        evaluator = evaluator.with_custom_function(name.into(), implementation);
    }
    evaluator
}

fn rdf_format(format: &str) -> Result<RdfFormat> {
    if format.contains('/') {
        RdfFormat::from_media_type(format)
    } else {
        RdfFormat::from_extension(format)
    }
    .ok_or_else(|| failed(format!("Not supported RDF format: {format}")))
}

fn results_format(format: &str) -> Result<QueryResultsFormat> {
    if format.contains('/') {
        QueryResultsFormat::from_media_type(format)
    } else {
        QueryResultsFormat::from_extension(format)
    }
    .ok_or_else(|| {
        failed(format!(
            "Not supported SPARQL query results format: {format}"
        ))
    })
}

#[napi(object)]
pub struct ParseOptions {
    pub format: String,
    #[napi(js_name = "base_iri")]
    pub base_iri: Option<String>,
    #[napi(js_name = "to_graph_name")]
    pub to_graph_name: Option<JsTerm>,
    pub lenient: Option<bool>,
}

fn parser(options: &ParseOptions) -> Result<RdfParser> {
    let mut parser = RdfParser::from_format(rdf_format(&options.format)?);
    if options.to_graph_name.is_some() {
        parser = parser.with_default_graph(graph(options.to_graph_name.as_ref())?);
    }
    if let Some(base) = &options.base_iri {
        parser = parser.with_base_iri(base.as_str()).map_err(failed)?;
    }
    if options.lenient.unwrap_or(false) {
        parser = parser.lenient();
    }
    Ok(parser)
}

fn bytes(data: &Either<String, Uint8Array>) -> &[u8] {
    match data {
        Either::A(text) => text.as_bytes(),
        Either::B(array) => array,
    }
}

/// The quads of the input, read whole.
#[napi]
pub fn parse(data: Either<String, Uint8Array>, options: ParseOptions) -> Result<Vec<JsQuad>> {
    parser(&options)?
        .for_slice(bytes(&data))
        .map(|quad| quad_of(&quad.map_err(failed)?))
        .collect()
}

#[napi(object)]
pub struct QueryOptions {
    #[napi(js_name = "results_format")]
    pub results_format: Option<String>,
    #[napi(js_name = "use_default_graph_as_union")]
    pub use_default_graph_as_union: Option<bool>,
    #[napi(js_name = "default_graph")]
    pub default_graph: Option<Vec<JsTerm>>,
}

#[napi(object)]
pub struct DumpOptions {
    pub format: String,
    #[napi(js_name = "from_graph_name")]
    pub from_graph_name: Option<JsTerm>,
}

/// An in-memory Oxigraph store.
#[napi]
pub struct Store {
    store: Option<oxigraph::store::Store>,
}

#[napi]
impl Store {
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        Ok(Self {
            store: Some(oxigraph::store::Store::new().map_err(failed)?),
        })
    }

    fn held(&self) -> Result<&oxigraph::store::Store> {
        self.store
            .as_ref()
            .ok_or_else(|| failed("the store was freed and is used again"))
    }

    /// Releases the quads the store holds now, rather than when the object is collected, which knows nothing of their
    /// size; the store is never used again.
    #[napi]
    pub fn free(&mut self) {
        self.store = None;
    }

    #[napi(getter)]
    pub fn size(&self) -> Result<i64> {
        Ok(self.held()?.len().map_err(failed)? as i64)
    }

    #[napi]
    pub fn add(&self, quad: JsQuad) -> Result<()> {
        self.held()?.insert(&self::quad(&quad)?).map_err(failed)?;
        Ok(())
    }

    #[napi]
    pub fn delete(&self, quad: JsQuad) -> Result<()> {
        self.held()?.remove(&self::quad(&quad)?).map_err(failed)?;
        Ok(())
    }

    #[napi(js_name = "match")]
    pub fn match_quads(
        &self,
        subject: Option<JsTerm>,
        predicate: Option<JsTerm>,
        object: Option<JsTerm>,
        graph: Option<JsTerm>,
    ) -> Result<Vec<JsQuad>> {
        let subject = subject.as_ref().map(self::subject).transpose()?;
        let predicate = predicate.as_ref().map(named).transpose()?;
        let object = object.as_ref().map(self::object).transpose()?;
        let graph = graph
            .as_ref()
            .map(|graph| self::graph(Some(graph)))
            .transpose()?;
        self.held()?
            .quads_for_pattern(
                subject.as_ref().map(Into::into),
                predicate.as_ref().map(Into::into),
                object.as_ref().map(Into::into),
                graph.as_ref().map(Into::into),
            )
            .map(|quad| quad_of(&quad.map_err(failed)?))
            .collect()
    }

    #[napi]
    pub fn load(&self, data: Either<String, Uint8Array>, options: ParseOptions) -> Result<()> {
        self.held()?
            .load_from_slice(parser(&options)?, bytes(&data))
            .map_err(failed)
    }

    /// A SELECT's or a CONSTRUCT's answer written in `results_format`, which they need here; an ASK's as a boolean
    /// unless one is given.
    #[napi]
    pub fn query(
        &self,
        query: String,
        options: Option<QueryOptions>,
    ) -> Result<Either<bool, String>> {
        let mut prepared = evaluator().parse_query(&query).map_err(failed)?;
        let mut format = None;
        if let Some(options) = options {
            if options.use_default_graph_as_union.unwrap_or(false) {
                prepared.dataset_mut().set_default_graph_as_union();
            }
            if let Some(graphs) = &options.default_graph {
                prepared.dataset_mut().set_default_graph(
                    graphs
                        .iter()
                        .map(|term| graph(Some(term)))
                        .collect::<Result<Vec<_>>>()?,
                );
            }
            format = options.results_format;
        }
        let needs = || failed("a SELECT or a CONSTRUCT is answered here only in a results_format");
        let written = |bytes: Vec<u8>| String::from_utf8(bytes).map_err(failed);
        match prepared.on_store(self.held()?).execute().map_err(failed)? {
            QueryResults::Solutions(solutions) => {
                let format = format.ok_or_else(needs)?;
                let mut serializer = QueryResultsSerializer::from_format(results_format(&format)?)
                    .serialize_solutions_to_writer(Vec::new(), solutions.variables().into())
                    .map_err(failed)?;
                for solution in solutions {
                    serializer
                        .serialize(&solution.map_err(failed)?)
                        .map_err(failed)?;
                }
                Ok(Either::B(written(serializer.finish().map_err(failed)?)?))
            }
            QueryResults::Graph(triples) => {
                let format = format.ok_or_else(needs)?;
                let mut serializer =
                    RdfSerializer::from_format(rdf_format(&format)?).for_writer(Vec::new());
                for triple in triples {
                    serializer
                        .serialize_triple(&triple.map_err(failed)?)
                        .map_err(failed)?;
                }
                Ok(Either::B(written(serializer.finish().map_err(failed)?)?))
            }
            QueryResults::Boolean(answer) => match format {
                None => Ok(Either::A(answer)),
                Some(format) => Ok(Either::B(written(
                    QueryResultsSerializer::from_format(results_format(&format)?)
                        .serialize_boolean_to_writer(Vec::new(), answer)
                        .map_err(failed)?,
                )?)),
            },
        }
    }

    #[napi]
    pub fn update(&self, update: String) -> Result<()> {
        evaluator()
            .parse_update(&update)
            .map_err(failed)?
            .on_store(self.held()?)
            .execute()
            .map_err(failed)
    }

    #[napi]
    pub fn dump(&self, options: DumpOptions) -> Result<String> {
        let format = rdf_format(&options.format)?;
        let bytes = match &options.from_graph_name {
            Some(name) => {
                self.held()?
                    .dump_graph_to_writer(&graph(Some(name))?, format, Vec::new())
            }
            None => self.held()?.dump_to_writer(format, Vec::new()),
        }
        .map_err(failed)?;
        String::from_utf8(bytes).map_err(failed)
    }
}
