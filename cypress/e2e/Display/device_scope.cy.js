describe('Device resource scope', function() {
  it('preserves native filters across device changes and reset', function() {
    cy.intercept('GET', '/layout?*', {
      recordsTotal: 0, recordsFiltered: 0, data: [],
    });
    cy.visit('/layout/view');
    cy.get('#device-scope [data-display-id=""]').click();
    cy.get('#resolutionId').then(($select) => {
      $select.append(new Option('Saved resolution', '7', true, true))
        .trigger('change');
    });
    cy.get('#activeDisplayGroupId').then(($select) => {
      $select.append(new Option('Saved group', '12', true, true))
        .trigger('change');
    });
    cy.get('#device-scope [data-display-id="101"]').click();
    cy.get('#resolutionId').closest('.form-group').should('not.be.visible');
    cy.get('.device-scope-filter-note').should('be.visible');
    cy.get('.clear-filter-btn').first().click();
    cy.get('#device-scope [data-display-id="102"]').click();
    cy.get('#device-scope [data-display-id=""]').click();
    cy.get('#resolutionId').should('have.value', '7');
    cy.get('#activeDisplayGroupId').should('have.value', '12');
    cy.get('#resolutionId').closest('.form-group').should('be.visible');
    cy.get('.device-scope-filter-note').should('not.exist');
  });

  beforeEach(function() {
    cy.login();
    cy.intercept('GET', '/display?*', (request) => {
      if (request.query.length === '100') {
        request.reply({
          recordsTotal: 2,
          data: [
            {displayId: 101, displayGroupId: 201, display: 'Lobby'},
            {displayId: 102, displayGroupId: 202, display: 'Entrance'},
          ],
        });
      }
    }).as('devices');
  });

  it('filters, persists across pages, and clears with All', function() {
    cy.intercept('GET', '/layout?*', (request) => {
      if (request.query.contextDisplayId === '101') {
        request.alias = 'scopedLayouts';
      }
    });
    cy.visit('/layout/view');
    cy.get('#device-scope [data-display-id="101"]').click();
    cy.get('#device-scope [data-display-id="101"]')
      .should('have.attr', 'aria-pressed', 'true');
    cy.wait('@scopedLayouts').its('request.query.contextDisplayId')
      .should('eq', '101');

    cy.visit('/template/view');
    cy.get('#device-scope [data-display-id="101"]')
      .should('have.attr', 'aria-pressed', 'true');
    cy.intercept('GET', '/template?*', (request) => {
      if (!request.query.contextDisplayId) request.alias = 'allTemplates';
    });
    cy.get('#device-scope [data-display-id=""]').click();
    cy.get('#device-scope [data-display-id=""]')
      .should('have.attr', 'aria-pressed', 'true');
    cy.wait('@allTemplates').its('request.query')
      .should('not.have.property', 'contextDisplayId');
  });

  it('does not scope campaigns or media', function() {
    cy.visit('/layout/view');
    cy.get('#device-scope [data-display-id="101"]').click();
    cy.visit('/library/view');
    cy.get('#device-scope').should('be.visible');
    cy.scrollTo('bottom', {ensureScrollable: false});
    cy.get('#device-scope').should(($bar) => {
      expect($bar[0].getBoundingClientRect().top).to.eq(0);
    });
    cy.get('#device-scope').should('have.attr', 'data-filter-enabled', 'false');
    cy.get('#device-scope [data-display-id="102"]').click();
    cy.visit('/campaign/view');
    cy.get('#device-scope').should('be.visible');
    cy.get('#device-scope').should('have.attr', 'data-filter-enabled', 'false');
    cy.visit('/resolution/view');
    cy.get('#device-scope [data-display-id="102"]')
      .should('have.attr', 'aria-pressed', 'true');
  });
});
