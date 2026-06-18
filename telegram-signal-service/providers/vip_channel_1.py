from providers.generic import GenericProviderParser


class VipChannel1Parser(GenericProviderParser):
    """Provider-specific hook for VIP_Channel_1.

    Keep this class even while it uses the generic parser so future format
    changes can be isolated to this provider without touching other channels.
    """
