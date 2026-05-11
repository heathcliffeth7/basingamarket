//! Deterministic SVG render model for canvas and share cards.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const RENDERER_VERSION: &str = "renderer-v0";
pub const THEME_VERSION: &str = "theme-v0";
pub const LAYOUT_VERSION: &str = "layout-v0";
pub const ASSET_VERSION: &str = "asset-v0";
pub const PNG_BACKEND: &str = if cfg!(feature = "png") {
    "resvg"
} else {
    "disabled"
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RenderModel {
    pub market_id: u64,
    pub question: String,
    pub outcomes: Vec<OutcomeSummary>,
    pub tickets: Vec<TicketSummary>,
    pub canvas_objects: Vec<CanvasItem>,
    pub theme_version: String,
    pub layout_version: String,
    pub asset_version: String,
    pub renderer_version: String,
}

impl RenderModel {
    pub fn new(market_id: u64, question: impl Into<String>) -> Self {
        Self {
            market_id,
            question: question.into(),
            outcomes: Vec::new(),
            tickets: Vec::new(),
            canvas_objects: Vec::new(),
            theme_version: THEME_VERSION.to_owned(),
            layout_version: LAYOUT_VERSION.to_owned(),
            asset_version: ASSET_VERSION.to_owned(),
            renderer_version: RENDERER_VERSION.to_owned(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OutcomeSummary {
    pub outcome_id: u8,
    pub label: String,
    pub total_stake: String,
    pub current_odds: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TicketSummary {
    pub ticket_id: u64,
    pub owner: String,
    pub outcome_id: u8,
    pub stake_amount: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CanvasItem {
    pub ticket_id: u64,
    pub owner: String,
    pub x: i32,
    pub y: i32,
    pub radius: u16,
    pub mood: u8,
    pub confidence: u16,
    pub listed: bool,
    pub z_index: i32,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Error)]
pub enum RenderError {
    #[error("PNG export is disabled; build with the png feature to wire resvg")]
    PngExportDisabled,
    #[error("SVG parse failed: {0}")]
    SvgParse(String),
    #[error("SVG has invalid pixel size")]
    InvalidPixmapSize,
    #[error("PNG encode failed: {0}")]
    PngEncode(String),
}

pub fn render_market_svg(model: &RenderModel) -> String {
    let mut canvas_items = model.canvas_objects.clone();
    canvas_items.sort_by_key(|item| (item.z_index, item.ticket_id));

    let mut outcomes = model.outcomes.clone();
    outcomes.sort_by_key(|outcome| outcome.outcome_id);

    let mut svg = String::new();
    svg.push_str(r#"<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img">"#);
    svg.push_str("<rect width=\"1200\" height=\"630\" fill=\"#f7f3ea\"/>");
    svg.push_str("<rect x=\"48\" y=\"44\" width=\"1104\" height=\"542\" rx=\"8\" fill=\"#ffffff\" stroke=\"#202124\" stroke-width=\"2\"/>");
    svg.push_str(&format!(
        "<text x=\"80\" y=\"104\" font-family=\"Inter,Arial,sans-serif\" font-size=\"34\" font-weight=\"700\" fill=\"#202124\">{}</text>",
        escape_xml(&model.question)
    ));
    svg.push_str(&format!(
        "<text x=\"80\" y=\"140\" font-family=\"Inter,Arial,sans-serif\" font-size=\"16\" fill=\"#65717b\">market #{}, {}, {}, {}</text>",
        model.market_id,
        escape_xml(&model.theme_version),
        escape_xml(&model.layout_version),
        escape_xml(&model.renderer_version)
    ));

    let mut outcome_y = 188;
    for outcome in outcomes {
        let width = 230_i32;
        let x = 80 + i32::from(outcome.outcome_id) * 260;
        svg.push_str(&format!(
            "<g><rect x=\"{x}\" y=\"{outcome_y}\" width=\"{width}\" height=\"70\" rx=\"6\" fill=\"#e7f0ea\" stroke=\"#24362a\"/>"
        ));
        svg.push_str(&format!(
            "<text x=\"{}\" y=\"{}\" font-family=\"Inter,Arial,sans-serif\" font-size=\"18\" font-weight=\"700\" fill=\"#24362a\">{}</text>",
            x + 18,
            outcome_y + 28,
            escape_xml(&outcome.label)
        ));
        svg.push_str(&format!(
            "<text x=\"{}\" y=\"{}\" font-family=\"Inter,Arial,sans-serif\" font-size=\"14\" fill=\"#46534a\">stake {} / lean {}</text></g>",
            x + 18,
            outcome_y + 52,
            escape_xml(&outcome.total_stake),
            escape_xml(&outcome.current_odds)
        ));
        if outcome.outcome_id % 4 == 3 {
            outcome_y += 86;
        }
    }

    svg.push_str("<g id=\"canvas\">");
    for item in canvas_items {
        let color = fallback_color(&item.owner, item.ticket_id);
        let stroke = if item.listed { "#c2410c" } else { "#202124" };
        let stroke_width = if item.listed { 4 } else { 2 };
        svg.push_str(&format!(
            "<g transform=\"translate({}, {})\"><circle r=\"{}\" fill=\"{}\" stroke=\"{}\" stroke-width=\"{}\"/>",
            item.x,
            item.y,
            item.radius,
            color,
            stroke,
            stroke_width
        ));
        svg.push_str(&format!(
            "<text x=\"0\" y=\"5\" text-anchor=\"middle\" font-family=\"Inter,Arial,sans-serif\" font-size=\"13\" font-weight=\"700\" fill=\"#202124\">#{}</text>",
            item.ticket_id
        ));
        svg.push_str("</g>");
    }
    svg.push_str("</g>");
    svg.push_str("</svg>");
    svg
}

pub fn render_share_card_svg(model: &RenderModel, ticket_id: u64) -> String {
    let mut share_model = model.clone();
    share_model.question = format!("{} - Ticket #{ticket_id}", share_model.question);
    render_market_svg(&share_model)
}

pub fn svg_hash(svg: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(svg.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn render_model_hash(model: &RenderModel) -> String {
    let svg = render_market_svg(model);
    svg_hash(&svg)
}

#[cfg(feature = "png")]
pub fn svg_to_png(svg: &str) -> Result<Vec<u8>, RenderError> {
    let mut options = usvg::Options::default();
    options.fontdb_mut().load_system_fonts();
    let tree = usvg::Tree::from_data(svg.as_bytes(), &options)
        .map_err(|error| RenderError::SvgParse(error.to_string()))?;
    let pixmap_size = tree.size().to_int_size();
    let mut pixmap = tiny_skia::Pixmap::new(pixmap_size.width(), pixmap_size.height())
        .ok_or(RenderError::InvalidPixmapSize)?;

    resvg::render(&tree, tiny_skia::Transform::default(), &mut pixmap.as_mut());
    pixmap
        .encode_png()
        .map_err(|error| RenderError::PngEncode(error.to_string()))
}

#[cfg(not(feature = "png"))]
pub fn svg_to_png(_svg: &str) -> Result<Vec<u8>, RenderError> {
    Err(RenderError::PngExportDisabled)
}

fn fallback_color(owner: &str, ticket_id: u64) -> String {
    let mut hasher = Sha256::new();
    hasher.update(owner.as_bytes());
    hasher.update(ticket_id.to_be_bytes());
    let bytes = hasher.finalize();
    format!(
        "#{:02x}{:02x}{:02x}",
        96 + bytes[0] % 120,
        96 + bytes[1] % 120,
        96 + bytes[2] % 120
    )
}

fn escape_xml(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_OWNER: &str = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
    const TEST_BUYER: &str = "So11111111111111111111111111111111111111112";

    fn model() -> RenderModel {
        let mut model = RenderModel::new(1, "Will SOL stay volatile?");
        model.outcomes.push(OutcomeSummary {
            outcome_id: 0,
            label: "Yes".to_owned(),
            total_stake: "1000000".to_owned(),
            current_odds: "1500000".to_owned(),
        });
        model.canvas_objects.push(CanvasItem {
            ticket_id: 2,
            owner: TEST_BUYER.to_owned(),
            x: 240,
            y: 380,
            radius: 34,
            mood: 1,
            confidence: 80,
            listed: true,
            z_index: 2,
            avatar_url: None,
        });
        model.canvas_objects.push(CanvasItem {
            ticket_id: 1,
            owner: TEST_OWNER.to_owned(),
            x: 180,
            y: 360,
            radius: 34,
            mood: 0,
            confidence: 60,
            listed: false,
            z_index: 1,
            avatar_url: None,
        });
        model
    }

    #[test]
    fn same_state_produces_same_svg_hash() {
        let model = model();
        let first = render_model_hash(&model);
        let second = render_model_hash(&model);

        assert_eq!(first, second);
    }

    #[test]
    fn missing_avatar_uses_deterministic_fallback_color() {
        let model = model();
        let svg = render_market_svg(&model);

        assert!(svg.contains("#1"));
        assert!(svg.contains("#2"));
        assert!(svg.contains("stroke=\"#c2410c\""));
    }

    #[test]
    fn crowded_canvas_remains_deterministic() {
        let mut model = RenderModel::new(9, "Crowded?");
        for ticket_id in 0..80 {
            model.canvas_objects.push(CanvasItem {
                ticket_id,
                owner: format!("{TEST_OWNER}{ticket_id}"),
                x: 90 + ((ticket_id % 20) as i32 * 48),
                y: 250 + ((ticket_id / 20) as i32 * 56),
                radius: 20,
                mood: (ticket_id % 5) as u8,
                confidence: 50,
                listed: ticket_id % 7 == 0,
                z_index: ticket_id as i32,
                avatar_url: None,
            });
        }

        assert_eq!(render_model_hash(&model), render_model_hash(&model));
    }

    #[test]
    fn svg_exports_to_png_with_resvg() {
        let svg = render_market_svg(&model());
        let png = svg_to_png(&svg).unwrap();

        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
    }
}
