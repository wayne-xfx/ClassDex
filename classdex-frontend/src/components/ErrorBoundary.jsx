import { Component } from "react";
import Icon from "./Icon";
import { Badge, Button, Card } from "./DesignSystem";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
    this.handleReload = this.handleReload.bind(this);
    this.handleGoHome = this.handleGoHome.bind(this);
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ClassDex ErrorBoundary caught an error:", error, errorInfo);
  }

  handleReload() {
    window.location.reload();
  }

  handleGoHome(event) {
    event.preventDefault();
    this.setState({ hasError: false }, () => {
      window.location.assign("/");
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="error-boundary-shell">
          <Card className="error-boundary-card" role="alert">
            <div className="error-boundary-badge-row">
              <span className="eyebrow">
                <Icon name="sparkles" /> ClassDex
              </span>
              <Badge tone="danger">Unexpected error</Badge>
            </div>
            <h1>Something went wrong on this page</h1>
            <p>
              ClassDex ran into an unexpected problem while displaying this view. Your saved class
              records are safe—reload the page or head back to your home workspace.
            </p>
            <div className="design-error-state-actions">
              <Button variant="primary" onClick={this.handleReload}>
                <Icon name="refresh" size={16} /> Reload page
              </Button>
              <a href="/" className="button button-secondary" onClick={this.handleGoHome}>
                Go to home
              </a>
            </div>
          </Card>
        </main>
      );
    }

    return this.props.children;
  }
}
