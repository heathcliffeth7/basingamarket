use basingamarket_observability::prometheus_metric_names;

pub(crate) async fn metrics() -> String {
    prometheus_metric_names()
        .into_iter()
        .map(|name| {
            format!("# HELP {name} declared by basingamarket\n# TYPE {name} gauge\n{name} 0\n")
        })
        .collect::<Vec<_>>()
        .join("\n")
}
